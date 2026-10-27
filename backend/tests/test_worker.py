from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.db import SessionLocal
from app.models import Project, TranscriptSegment, User
from app.security import hash_password
from app.worker import process_project
from app.youtube_import import YouTubeImportCancelled


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


def test_url_worker_persists_source_for_authenticated_range(client, auth, tmp_path):
    media_bytes = b"synthetic-imported-media"
    with patch("app.main.dispatch_outbox"), patch("app.main.validate_https_public_url"):
        response = client.post("/api/projects", headers=auth, json={
            "title": "URL importada",
            "source_url": "https://media.example/video.mp4",
            "duration_seconds": 30,
            "rights_confirmed": True,
        })
    assert response.status_code == 201
    project_id = response.json()["id"]

    def download(_url, target):
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(media_bytes)

    worker_settings = SimpleNamespace(
        storage_dir=tmp_path,
        max_source_duration_seconds=3600,
        gemini_api_key=None,
    )
    with patch("app.worker.s", worker_settings), \
         patch("app.worker.download_source", side_effect=download), \
         patch("app.worker.probe_media", return_value={"duration": 90, "width": 640, "height": 360, "has_audio": True, "has_video": True}), \
         patch("app.worker.transcribe", return_value=("pt", [{"start": 0, "end": 2, "text": "fala"}])):
        process_project(project_id)

    with SessionLocal() as db:
        saved = db.get(Project, project_id)
        assert saved.status == "ready"
        assert saved.source_path == str(tmp_path / saved.user_id / saved.id / "source.mp4")

    ranged = client.get(f"/api/projects/{project_id}/source", headers={"Range": "bytes=2-7"})
    assert ranged.status_code == 206
    assert ranged.headers["content-range"] == f"bytes 2-7/{len(media_bytes)}"
    assert ranged.content == media_bytes[2:8]


def test_cancelled_youtube_import_does_not_persist_unfinished_source(tmp_path):
    with SessionLocal() as db:
        user = User(email="cancelled-import@example.com", password_hash=hash_password("long-password"))
        db.add(user); db.flush()
        project = Project(
            user_id=user.id, title="cancelled", source_url="https://youtu.be/AbCdEf12_-3",
            duration_seconds=30, status="queued", stage="importing",
        )
        db.add(project); db.commit(); project_id = project.id
    worker_settings = SimpleNamespace(
        storage_dir=tmp_path,
        max_source_duration_seconds=3600,
        gemini_api_key=None,
    )
    with patch("app.worker.s", worker_settings), \
         patch("app.worker.import_youtube_video", side_effect=YouTubeImportCancelled("cancelled")):
        process_project(project_id)
    with SessionLocal() as db:
        saved = db.get(Project, project_id)
        assert saved.status == "cancelled"
        assert saved.source_path is None
