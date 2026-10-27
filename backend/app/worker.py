import random
import secrets
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from celery import Celery
from sqlalchemy import or_, select, update

from .config import get_settings
from .db import SessionLocal
from .integrations import download_source, suggest_clips, translate_segments
from .media import build_ass, build_srt, probe_media, render, transcribe
from .models import Account, Clip, Cue, Outbox, Project, Publication, TranscriptSegment
from .youtube import PermanentPublishError, TransientPublishError, reconcile_status, upload
from .youtube_import import YouTubeImportCancelled, canonicalize_youtube_url, import_youtube_video

s = get_settings()
class CancelledJob(RuntimeError): ...
celery_app = Celery("cortes", broker=s.redis_url, backend=s.redis_url)
celery_app.conf.update(
    task_always_eager=s.celery_task_always_eager,
    task_eager_propagates=True,
    task_routes={
        "app.worker.process_project": {"queue": "media"},
        "app.worker.render_clip": {"queue": "media"},
        "app.worker.publish": {"queue": "publication"},
        "app.worker.dispatch_due": {"queue": "maintenance"},
        "app.worker.reconcile_outbox": {"queue": "maintenance"},
        "app.worker.reconcile_publications": {"queue": "maintenance"},
        "app.worker.cleanup_project": {"queue": "maintenance"},
        "app.worker.cleanup_deleted_projects": {"queue": "maintenance"},
    },
    beat_schedule={
        "dispatch-due": {"task": "app.worker.dispatch_due", "schedule": 60.0},
        "reconcile-outbox": {"task": "app.worker.reconcile_outbox", "schedule": 30.0},
        "reconcile-publications": {"task": "app.worker.reconcile_publications", "schedule": 120.0},
        "cleanup-deleted": {"task": "app.worker.cleanup_deleted_projects", "schedule": 3600.0},
    },
)


def enqueue(kind: str, object_id: str) -> None:
    celery_app.send_task(f"app.worker.{kind}", args=[object_id])


def dispatch_outbox(outbox_id: str) -> bool:
    """Atomically lease then dispatch an outbox row.

    A crash after broker acceptance remains an at-least-once delivery; every
    consumer below therefore verifies durable state before side effects.
    """
    token = secrets.token_urlsafe(24)
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        claimed = db.execute(
            update(Outbox).where(
                Outbox.id == outbox_id,
                Outbox.sent_at.is_(None),
                or_(Outbox.lease_expires_at.is_(None), Outbox.lease_expires_at < now),
            ).values(lease_token=token, lease_expires_at=now + timedelta(minutes=5), attempts=Outbox.attempts + 1)
        )
        db.commit()
        if claimed.rowcount != 1:
            return False
        row = db.get(Outbox, outbox_id)
        kind, object_id = row.kind, row.object_id
    try:
        enqueue(kind, object_id)
    except Exception as exc:
        with SessionLocal() as db:
            db.execute(update(Outbox).where(Outbox.id == outbox_id, Outbox.lease_token == token).values(lease_token=None, lease_expires_at=None, error=str(exc)[:1000]))
            db.commit()
        return False
    with SessionLocal() as db:
        db.execute(update(Outbox).where(Outbox.id == outbox_id, Outbox.lease_token == token).values(sent_at=datetime.now(timezone.utc), lease_token=None, lease_expires_at=None, error=None))
        db.commit()
    return True


def _cues_for_window(db, project_id: str, start: float, end: float):
    return db.scalars(select(TranscriptSegment).where(
        TranscriptSegment.project_id == project_id,
        TranscriptSegment.end_seconds > start,
        TranscriptSegment.start_seconds < end,
    ).order_by(TranscriptSegment.start_seconds)).all()


def _ensure_project_active(db, project: Project) -> None:
    db.refresh(project)
    if project.deleted_at:
        raise CancelledJob("Projeto cancelado")


def _project_cancelled(project_id: str) -> bool:
    with SessionLocal() as check_db:
        project = check_db.get(Project, project_id)
        return not project or project.deleted_at is not None or project.status == "cancelled"


@celery_app.task(name="app.worker.process_project")
def process_project(project_id: str):
    with SessionLocal() as db:
        project = db.scalar(select(Project).where(Project.id == project_id).with_for_update())
        if not project or project.deleted_at or project.status == "ready":
            return
        try:
            project.status = "processing"; project.stage = "importing"; project.progress = 5; project.error = None; db.commit()
            source = Path(project.source_path) if project.source_path else s.storage_dir / project.user_id / project.id / "source.mp4"
            if project.source_url and not project.source_path:
                if canonicalize_youtube_url(project.source_url):
                    import_youtube_video(project.source_url, source, lambda: _project_cancelled(project.id))
                else:
                    download_source(project.source_url, source)
                project.source_path = str(source)
                # refresh() below checks durable cancellation state; flush the
                # imported path first so that refresh cannot discard it.
                db.flush()
            media = probe_media(source)
            _ensure_project_active(db, project)
            duration = media["duration"]
            if duration > s.max_source_duration_seconds:
                raise RuntimeError("Vídeo excede a duração máxima configurada")
            if duration < project.duration_seconds:
                raise RuntimeError(f"A fonte tem {duration:.1f}s e é menor que o corte escolhido de {project.duration_seconds}s")
            project.source_duration = duration; project.stage = "transcribing"; project.progress = 25; db.commit()

            existing = db.scalars(select(TranscriptSegment).where(TranscriptSegment.project_id == project.id).order_by(TranscriptSegment.start_seconds)).all()
            if not existing:
                language, raw_segments = transcribe(source)
                _ensure_project_active(db, project)
                project.language = language
                for raw in raw_segments:
                    db.add(TranscriptSegment(project_id=project.id, start_seconds=raw["start"], end_seconds=raw["end"], original_text=raw["text"]))
                db.commit()
                existing = db.scalars(select(TranscriptSegment).where(TranscriptSegment.project_id == project.id).order_by(TranscriptSegment.start_seconds)).all()
            if not existing:
                raise RuntimeError("Nenhuma fala foi detectada no vídeo")

            project.stage = "suggesting"; project.progress = 65; db.commit()
            transcript = [{"id": x.id, "start": x.start_seconds, "end": x.end_seconds, "text": x.original_text} for x in existing]
            warnings = []
            if s.gemini_api_key:
                try:
                    translated = translate_segments(transcript)
                    _ensure_project_active(db, project)
                    for row in existing:
                        if row.translated_text is None:
                            row.translated_text = translated.get(row.id)
                    db.commit()
                except Exception:
                    warnings.append("Tradução pt-BR indisponível; o texto original permanece editável")
                if not db.scalar(select(Clip.id).where(Clip.project_id == project.id).limit(1)):
                    try:
                        suggestions = suggest_clips(transcript, project.duration_seconds, duration, project.editing_instructions)
                        _ensure_project_active(db, project)
                    except Exception:
                        warnings.append("Sugestões automáticas indisponíveis; crie um corte manual")
                        suggestions = []
                    for suggestion in suggestions:
                        clip = Clip(project_id=project.id, start_seconds=suggestion.start_seconds, end_seconds=suggestion.start_seconds + project.duration_seconds, reason=suggestion.reason, score=suggestion.score)
                        db.add(clip); db.flush()
                        for segment in _cues_for_window(db, project.id, clip.start_seconds, clip.end_seconds):
                            db.add(Cue(clip_id=clip.id, start_seconds=max(segment.start_seconds, clip.start_seconds)-clip.start_seconds, end_seconds=min(segment.end_seconds, clip.end_seconds)-clip.start_seconds, original_text=segment.original_text, translated_text=segment.translated_text))
            else:
                suffix = " As orientações editoriais foram preservadas, mas não aplicadas automaticamente." if project.editing_instructions else ""
                warnings.append("Gemini não configurado: tradução e sugestões automáticas indisponíveis; crie um corte manual." + suffix)
            project.status = "ready"; project.stage = "ready"; project.progress = 100; project.error = "; ".join(warnings) or None; db.commit()
        except (CancelledJob, YouTubeImportCancelled):
            project.status = "cancelled"; project.progress = None; db.commit()
        except Exception as exc:
            project.status = "failed"; project.error = str(exc)[:2000]; project.progress = None; db.commit(); raise


@celery_app.task(name="app.worker.render_clip")
def render_clip(clip_id: str):
    with SessionLocal() as db:
        clip = db.scalar(select(Clip).where(Clip.id == clip_id).with_for_update())
        if not clip or clip.project.deleted_at or clip.status == "ready":
            return
        snapshot = clip.approved_snapshot
        if not snapshot or clip.approved_revision != snapshot.get("revision") or clip.revision != snapshot.get("revision"):
            return
        revision = snapshot["revision"]
        clip.status = "rendering"; clip.error = None; db.commit()
        folder = s.storage_dir / clip.project.user_id / clip.project.id / "clips" / clip.id / f"r{revision}"
        target = folder / "video.mp4"
        srt = folder / "subtitles.srt"
        ass = folder / "subtitles.ass"
        try:
            folder.mkdir(parents=True, exist_ok=True)
            cues = [SimpleNamespace(**x) for x in snapshot["cues"]]
            srt.write_text(build_srt(cues, snapshot["subtitle_mode"]), encoding="utf-8")
            ass.write_text(build_ass(cues, snapshot["subtitle_mode"], snapshot["style"]), encoding="utf-8")
            render(Path(clip.project.source_path), target, ass, snapshot["start_seconds"], snapshot["end_seconds"]-snapshot["start_seconds"], snapshot["framing"], snapshot["style"])
            with SessionLocal() as final_db:
                current = final_db.scalar(select(Clip).where(Clip.id == clip_id).with_for_update())
                if not current or current.revision != revision or current.approved_revision != revision or current.project.deleted_at:
                    target.unlink(missing_ok=True); return
                current.artifact_path = str(target); current.srt_path = str(srt); current.status = "ready"; current.error = None; final_db.commit()
        except Exception as exc:
            with SessionLocal() as failed_db:
                current = failed_db.get(Clip, clip_id)
                if current and current.revision == revision:
                    current.status = "failed"; current.error = str(exc)[:2000]; failed_db.commit()
            raise


@celery_app.task(name="app.worker.publish", bind=True, max_retries=2)
def publish(self, publication_id: str):
    with SessionLocal() as db:
        publication = db.scalar(select(Publication).where(Publication.id == publication_id).with_for_update())
        if not publication or publication.status in ("cancelled", "published", "private", "unlisted", "processing", "needs_attention", "failed"):
            return
        account = db.scalar(select(Account).where(Account.id == publication.account_id).with_for_update())
        try:
            if not publication.artifact_path:
                raise PermanentPublishError("Artefato da revisão fixada indisponível")
            publication.status = "uploading"; db.commit()
            upload(db, publication, account, Path(publication.artifact_path))
        except PermanentPublishError as exc:
            if publication.status not in ("needs_attention","cancelled"): publication.status = "failed"
            publication.error = str(exc)[:2000]; db.commit()
        except Exception as exc:
            publication.attempts += 1; publication.error = str(exc)[:2000]
            if publication.attempts >= 3:
                publication.status = "needs_attention"; db.commit(); return
            publication.status = "queued"; db.commit()
            countdown = min(300, 2 ** publication.attempts + random.randint(0, 3))
            raise self.retry(exc=exc, countdown=countdown)


@celery_app.task(name="app.worker.dispatch_due")
def dispatch_due():
    now = datetime.now(timezone.utc)
    outbox_ids = []
    with SessionLocal() as db:
        publications = db.scalars(select(Publication).where(Publication.status == "scheduled", Publication.scheduled_at <= now).with_for_update(skip_locked=True)).all()
        for publication in publications:
            scheduled = publication.scheduled_at.replace(tzinfo=timezone.utc) if publication.scheduled_at.tzinfo is None else publication.scheduled_at
            account = db.get(Account, publication.account_id)
            if not account or account.revoked_at:
                publication.status = "cancelled"; publication.error = "Conta desconectada"
            elif (now - scheduled).total_seconds() > 900:
                publication.status = "needs_attention"; publication.error = "Agendamento atrasado mais de 15 minutos; confirmação manual necessária"
            else:
                publication.status = "queued"; event = Outbox(kind="publish", object_id=publication.id); db.add(event); db.flush(); outbox_ids.append(event.id)
        db.commit()
    for outbox_id in outbox_ids:
        dispatch_outbox(outbox_id)


@celery_app.task(name="app.worker.reconcile_outbox")
def reconcile_outbox():
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        ids = list(db.scalars(select(Outbox.id).where(Outbox.sent_at.is_(None), or_(Outbox.lease_expires_at.is_(None), Outbox.lease_expires_at < now)).order_by(Outbox.created_at).limit(100)).all())
    for outbox_id in ids:
        dispatch_outbox(outbox_id)


@celery_app.task(name="app.worker.reconcile_publications")
def reconcile_publications():
    with SessionLocal() as db:
        rows = db.scalars(select(Publication).where(Publication.status.in_(["uploading", "processing"])).with_for_update(skip_locked=True)).all()
        for publication in rows:
            account = db.scalar(select(Account).where(Account.id == publication.account_id).with_for_update())
            try:
                reconcile_status(db, publication, account)
            except PermanentPublishError as exc:
                publication.status = "needs_attention"; publication.error = str(exc)[:2000]; db.commit()
            except Exception as exc:
                publication.error = ("Não foi possível reconciliar o estado remoto: " + str(exc))[:2000]; db.commit()


def _safe_project_folder(project: Project) -> Path:
    root = s.storage_dir.resolve()
    folder = (root / project.user_id / project.id).resolve()
    if root not in folder.parents:
        raise RuntimeError("Caminho de armazenamento inválido")
    return folder


@celery_app.task(name="app.worker.cleanup_project")
def cleanup_project(project_id: str):
    with SessionLocal() as db:
        project = db.get(Project, project_id)
        if not project or not project.deleted_at:
            return
        deleted_at = project.deleted_at.replace(tzinfo=timezone.utc) if project.deleted_at.tzinfo is None else project.deleted_at
        if datetime.now(timezone.utc) < deleted_at + timedelta(days=s.retention_days):
            return
        active = db.scalar(select(Publication.id).join(Clip, Publication.clip_id == Clip.id).where(Clip.project_id == project.id, Publication.status.in_(["scheduled", "queued", "uploading", "processing"])).limit(1))
        if active:
            return
        folder = _safe_project_folder(project)
        if folder.exists():
            shutil.rmtree(folder, ignore_errors=False)


@celery_app.task(name="app.worker.cleanup_deleted_projects")
def cleanup_deleted_projects():
    cutoff = datetime.now(timezone.utc) - timedelta(days=s.retention_days)
    with SessionLocal() as db:
        ids = list(db.scalars(select(Project.id).where(Project.deleted_at.is_not(None), Project.deleted_at <= cutoff)).all())
    for project_id in ids:
        cleanup_project(project_id)
