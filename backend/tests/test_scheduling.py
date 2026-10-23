from datetime import datetime,timedelta,timezone
from app.integrations import publication_key
from app.db import SessionLocal
from app.models import Account,Clip,Outbox,Project,Publication,User
from app.security import encrypt,hash_password
from app.worker import dispatch_due,dispatch_outbox
from unittest.mock import patch

def test_idempotency_key_is_stable():
    when=datetime.now(timezone.utc).replace(microsecond=0)
    a=publication_key("u","c",2,"a","title",when); b=publication_key("u","c",2,"a","title",when)
    assert a==b and len(a)==64

def test_overdue_schedule_needs_attention():
    with SessionLocal() as db:
        user=User(email="schedule@example.com",password_hash=hash_password("long-password")); db.add(user); db.flush()
        project=Project(user_id=user.id,title="p",duration_seconds=30); db.add(project); db.flush()
        clip=Clip(project_id=project.id,start_seconds=0,end_seconds=30); db.add(clip); db.flush()
        account=Account(user_id=user.id,display_name="channel",access_token=encrypt("token")); db.add(account); db.flush()
        pub=Publication(user_id=user.id,clip_id=clip.id,revision=1,account_id=account.id,title="t",visibility="private",made_for_kids=False,contains_synthetic_media=False,scheduled_at=datetime.now(timezone.utc)-timedelta(minutes=16),timezone="UTC",idempotency_key="key",status="scheduled")
        db.add(pub); db.commit(); pid=pub.id
    dispatch_due()
    with SessionLocal() as db:
        saved=db.get(Publication,pid); assert saved.status=="needs_attention" and "15 minutos" in saved.error

def test_outbox_claim_dispatches_once():
    with SessionLocal() as db:
        row=Outbox(kind="process_project",object_id="object"); db.add(row); db.commit(); row_id=row.id
    with patch("app.worker.enqueue") as enqueue:
        assert dispatch_outbox(row_id) is True
        assert dispatch_outbox(row_id) is False
        enqueue.assert_called_once_with("process_project","object")
