from unittest.mock import patch

import httpx

from app.db import SessionLocal
from app.models import Account, Clip, Project, Publication, User
from app.security import encrypt, hash_password
from app.youtube import upload


class FakeYouTube:
    def __init__(self, publication): self.publication=publication; self.puts=0
    def __enter__(self): return self
    def __exit__(self,*args): return False
    def post(self,*args,**kwargs):
        return httpx.Response(200,headers={"location":"https://www.googleapis.com/upload/session/abc"})
    def put(self,*args,**kwargs):
        assert self.publication.upload_session_uri is not None  # committed before media/query bytes
        self.puts+=1
        if self.puts==1: return httpx.Response(308)
        return httpx.Response(200,json={"id":"video-id"})


def test_resumable_session_is_encrypted_and_persisted_before_bytes(tmp_path):
    artifact=tmp_path/"clip.mp4"; artifact.write_bytes(b"media-bytes")
    with SessionLocal() as db:
        user=User(email="youtube@example.com",password_hash=hash_password("long-password")); db.add(user); db.flush()
        project=Project(user_id=user.id,title="p",duration_seconds=30); db.add(project); db.flush()
        clip=Clip(project_id=project.id,start_seconds=0,end_seconds=30); db.add(clip); db.flush()
        account=Account(user_id=user.id,display_name="channel",access_token=encrypt("access")); db.add(account); db.flush()
        publication=Publication(user_id=user.id,clip_id=clip.id,revision=1,account_id=account.id,title="title",visibility="private",made_for_kids=False,contains_synthetic_media=False,timezone="UTC",idempotency_key="upload",status="queued",artifact_path=str(artifact))
        db.add(publication); db.commit(); publication_id=publication.id
        fake=FakeYouTube(publication)
        with patch("app.youtube.httpx.Client",return_value=fake):
            upload(db,publication,account,artifact)
    with SessionLocal() as db:
        saved=db.get(Publication,publication_id)
        assert saved.status=="processing" and saved.remote_id=="video-id"
        assert b"googleapis.com" not in saved.upload_session_uri
