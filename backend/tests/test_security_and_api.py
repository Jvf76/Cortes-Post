from datetime import datetime,timezone,timedelta
from unittest.mock import patch
from app.db import SessionLocal
from app.models import Account,Clip,Project,Publication,TranscriptSegment,User
from app.security import decrypt,encrypt,validate_https_public_url

def test_auth_csrf_and_isolation(client,auth):
    me=client.get("/api/auth/me"); assert me.status_code==200
    assert client.get("/api/auth/me").json()["csrf_token"]==me.json()["csrf_token"]
    auth={"X-CSRF-Token":me.json()["csrf_token"]}
    assert client.post("/api/projects",json={"title":"x","source_url":"https://example.com/a.mp4","duration_seconds":30,"rights_confirmed":True}).status_code==403
    with patch("app.main.validate_https_public_url"),patch("app.main.dispatch_outbox"):
        made=client.post("/api/projects",headers=auth,json={"title":"x","source_url":"https://example.com/a.mp4","duration_seconds":30,"rights_confirmed":True})
    assert made.status_code==201
    other=client.post("/api/auth/register",json={"email":"other@example.com","password":"very-secure-password"}); other_csrf=other.json()["csrf_token"]
    assert client.get(f"/api/projects/{made.json()['id']}").status_code==404

def test_ssrf_private_address_rejected():
    with patch("socket.getaddrinfo",return_value=[(2,1,6,"",("127.0.0.1",443))]):
        try: validate_https_public_url("https://internal.example/video.mp4")
        except Exception as exc: assert getattr(exc,"status_code",None)==422
        else: assert False

def test_edit_invalidates_approval(client,auth):
    with SessionLocal() as db:
        user=db.query(User).filter_by(email="owner@example.com").one(); p=Project(user_id=user.id,title="P",duration_seconds=30,source_duration=100,status="ready",stage="review"); db.add(p); db.flush()
        c=Clip(project_id=p.id,start_seconds=0,end_seconds=30,approved_revision=1,status="approved"); db.add(c); db.commit(); cid=c.id
    r=client.patch(f"/api/clips/{cid}",headers=auth,json={"start_seconds":5})
    assert r.status_code==200 and r.json()["revision"]==2 and r.json()["status"]=="draft"
    with SessionLocal() as db: assert db.get(Clip,cid).approved_revision is None

def test_encryption_and_no_plaintext():
    token="secret-refresh-token"; encrypted=encrypt(token)
    assert token.encode() not in encrypted and decrypt(encrypted)==token

def test_manual_clip_loads_and_rebases_transcript(client,auth):
    with SessionLocal() as db:
        user=db.query(User).filter_by(email="owner@example.com").one()
        project=Project(user_id=user.id,title="P",duration_seconds=30,source_duration=100,status="ready",stage="ready")
        db.add(project); db.flush()
        db.add_all([
            TranscriptSegment(project_id=project.id,start_seconds=5,end_seconds=8,original_text="primeiro",translated_text="first"),
            TranscriptSegment(project_id=project.id,start_seconds=35,end_seconds=38,original_text="segundo",translated_text="second"),
        ]); db.commit(); project_id=project.id
    made=client.post(f"/api/projects/{project_id}/clips",headers=auth,json={"start_seconds":0})
    assert made.status_code==201 and [x["original_text"] for x in made.json()["cues"]]==["primeiro"]
    moved=client.patch(f"/api/clips/{made.json()['id']}",headers=auth,json={"start_seconds":30})
    assert moved.status_code==200 and [x["original_text"] for x in moved.json()["cues"]]==["segundo"]
    assert moved.json()["cues"][0]["start_seconds"]==5

def test_disconnect_cancels_pending_even_if_remote_revoke_is_uncertain(client,auth):
    with SessionLocal() as db:
        user=db.query(User).filter_by(email="owner@example.com").one()
        project=Project(user_id=user.id,title="P",duration_seconds=30); db.add(project); db.flush()
        clip=Clip(project_id=project.id,start_seconds=0,end_seconds=30); db.add(clip); db.flush()
        account=Account(user_id=user.id,display_name="canal",access_token=encrypt("access")); db.add(account); db.flush()
        publication=Publication(user_id=user.id,clip_id=clip.id,revision=1,account_id=account.id,title="t",visibility="private",made_for_kids=False,contains_synthetic_media=False,timezone="UTC",idempotency_key="disconnect",status="queued")
        db.add(publication); db.commit(); account_id=account.id; publication_id=publication.id
    with patch("app.main.httpx.Client") as http:
        http.return_value.__enter__.return_value.post.side_effect=RuntimeError("offline")
        response=client.delete(f"/api/accounts/{account_id}",headers=auth)
    assert response.status_code==204
    with SessionLocal() as db:
        account=db.get(Account,account_id); publication=db.get(Publication,publication_id)
        assert account.revoked_at is not None and account.access_token==b""
        assert publication.status=="cancelled" and "incerta" in publication.error
