"""Integration fixture: real API + PostgreSQL + Celery + FFmpeg, no AI or publishing.

Run in a backend container with the same env/volume and /checks mounted.
Only the synthetic source and known transcript are seeded directly; approval,
queue dispatch, rendering, private download and edits exercise real services.
"""
import json
import os
from pathlib import Path
import secrets
import subprocess
import time

import httpx
from app.config import get_settings
from app.db import SessionLocal
from app.models import Clip, Cue, Project

base = os.environ.get("SMOKE_API_URL", "http://backend:8000/api")
client = httpx.Client(base_url=base + "/", timeout=30)
identity = {"email": f"render-{secrets.token_hex(8)}@example.org", "password": secrets.token_urlsafe(24)}
registered = client.post("auth/register", json=identity)
assert registered.status_code == 201, registered.text
user_id = registered.json()["user"]["id"]
client.headers["X-CSRF-Token"] = registered.json()["csrf_token"]

with SessionLocal() as db:
    p = Project(user_id=user_id, title="Teste de integração — mídia sintética", duration_seconds=30,
                source_duration=32, status="ready", stage="ready", language="en", progress=100)
    db.add(p)
    db.flush()
    folder = get_settings().storage_dir / user_id / p.id
    folder.mkdir(parents=True, exist_ok=True)
    source = folder / "source.mp4"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
        "color=c=0x152c25:s=640x360:r=30", "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000",
        "-t", "32", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source)], check=True, timeout=60)
    p.source_path = str(source)
    clip = Clip(project_id=p.id, start_seconds=1, end_seconds=31, subtitle_mode="both")
    db.add(clip)
    db.flush()
    db.add(Cue(clip_id=clip.id, start_seconds=0, end_seconds=15, original_text="A real rendering test.", translated_text="Um teste real de renderização."))
    db.add(Cue(clip_id=clip.id, start_seconds=15, end_seconds=30, original_text="Review before publishing.", translated_text="Revise antes de publicar."))
    db.commit()
    clip_id, project_id = clip.id, p.id

assert client.get(f"clips/{clip_id}/download").status_code == 409
approved = client.post(f"clips/{clip_id}/approve", json={"revision": 1})
assert approved.status_code == 200, approved.text
deadline = time.monotonic() + 240
while time.monotonic() < deadline:
    result = client.get(f"clips/{clip_id}")
    assert result.status_code == 200, result.text
    detail = result.json()
    if detail["status"] == "ready": break
    assert detail["status"] != "failed", detail.get("error")
    time.sleep(2)
else:
    raise AssertionError("Render did not finish within 240 seconds")

video = client.get(f"clips/{clip_id}/download")
assert video.status_code == 200 and len(video.content) > 1000
range_response = client.get(f"clips/{clip_id}/download", headers={"Range": "bytes=0-99"})
assert range_response.status_code == 206 and len(range_response.content) == 100
subtitles = client.get(f"clips/{clip_id}/subtitles")
assert subtitles.status_code == 200 and "renderização" in subtitles.text
downloaded = folder / "verified-export.mp4"
downloaded.write_bytes(video.content)
meta = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(downloaded)]))
v = next(s for s in meta["streams"] if s["codec_type"] == "video")
assert (v["width"], v["height"], v["codec_name"], v["pix_fmt"]) == (1080, 1920, "h264", "yuv420p"), v
assert any(s["codec_type"] == "audio" and s["codec_name"] == "aac" for s in meta["streams"])
assert abs(float(v["duration"]) - 30) <= 1 / 30 + 0.001
assert httpx.get(f"{base}/clips/{clip_id}/download").status_code == 401
changed = client.patch(f"clips/{clip_id}", json={"subtitle_mode": "original"})
assert changed.status_code == 200 and changed.json()["revision"] == 2
assert changed.json()["status"] == "draft" and changed.json()["artifact_url"] is None
assert client.post(f"clips/{clip_id}/approve", json={"revision":1}).status_code == 409
assert client.get(f"clips/{clip_id}/download").status_code == 409
deleted = client.delete(f"projects/{project_id}")
assert deleted.status_code == 204
assert client.get(f"projects/{project_id}").status_code == 404
print("PASS real approval -> queue -> FFmpeg 30s 1080x1920 H264/AAC -> Range/private download -> edit invalidation -> deletion")
print("ASR/translation providers are not exercised by this known-transcript fixture; no publication performed.")
