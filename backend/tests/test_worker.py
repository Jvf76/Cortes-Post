from unittest.mock import patch

import pytest

from app.db import SessionLocal
from app.models import Project, TranscriptSegment, User
from app.security import hash_password
from app.worker import process_project


def _project(duration=30):
    with SessionLocal() as db:
        user=User(email=f"worker-{duration}@example.com",password_hash=hash_password("long-password")); db.add(user); db.flush()
        project=Project(user_id=user.id,title="worker",source_path="/tmp/source.mp4",duration_seconds=duration,status="queued",stage="importing")
        db.add(project); db.commit(); return project.id


def test_project_without_gemini_remains_manually_reviewable():
    project_id=_project()
    with patch("app.worker.probe_media",return_value={"duration":90,"width":640,"height":360,"has_audio":True,"has_video":True}), patch("app.worker.transcribe",return_value=("pt",[{"start":2,"end":5,"text":"fala real"}])):
        process_project(project_id)
    with SessionLocal() as db:
        project=db.get(Project,project_id)
        assert (project.status,project.stage,project.progress)==("ready","ready",100)
        assert "Gemini não configurado" in project.error
        assert db.query(TranscriptSegment).filter_by(project_id=project_id).one().original_text=="fala real"


def test_source_shorter_than_requested_fails_clearly():
    project_id=_project(60)
    with patch("app.worker.probe_media",return_value={"duration":20,"width":640,"height":360,"has_audio":True,"has_video":True}):
        with pytest.raises(RuntimeError,match="menor que o corte"):
            process_project(project_id)
    with SessionLocal() as db:
        project=db.get(Project,project_id)
        assert project.status=="failed" and "menor que o corte" in project.error
