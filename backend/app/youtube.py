import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .integrations import PublisherAdapter
from .models import Account, Publication
from .security import decrypt, encrypt

SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
]
UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/youtube/v3/videos"


class PermanentPublishError(RuntimeError): ...
class TransientPublishError(RuntimeError): ...


def oauth_flow(state: str | None = None):
    settings = get_settings()
    if not settings.youtube_configured:
        raise RuntimeError("OAuth do YouTube não configurado")
    from google_auth_oauthlib.flow import Flow
    cfg = {"web": {
        "client_id": settings.youtube_client_id,
        "client_secret": settings.youtube_client_secret,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": [settings.youtube_redirect_uri],
    }}
    return Flow.from_client_config(cfg, scopes=SCOPES, state=state, redirect_uri=settings.youtube_redirect_uri)


def _access_token(db: Session, account: Account) -> str:
    account = db.scalar(select(Account).where(Account.id == account.id).with_for_update()) if account else None
    if not account or account.revoked_at is not None:
        raise PermanentPublishError("Conta do YouTube desconectada")
    token = decrypt(account.access_token)
    expiry = account.token_expiry
    if expiry and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry and expiry <= datetime.now(timezone.utc):
        if not account.refresh_token:
            raise PermanentPublishError("Credencial do YouTube expirada sem refresh token")
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        settings = get_settings()
        credentials = Credentials(
            token=token, refresh_token=decrypt(account.refresh_token),
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.youtube_client_id, client_secret=settings.youtube_client_secret,
            scopes=SCOPES,
        )
        try:
            credentials.refresh(Request())
        except Exception as exc:
            raise TransientPublishError("Não foi possível renovar a credencial do YouTube") from exc
        account.access_token = encrypt(credentials.token)
        account.token_expiry = credentials.expiry
        token = credentials.token
    db.commit()  # release the credential lock before network upload
    return token


def _ensure_not_cancelled(db: Session, publication: Publication) -> None:
    db.refresh(publication)
    if publication.status == "cancelled":
        raise PermanentPublishError("Publicação cancelada; resultado remoto pode exigir conferência")


def _metadata(publication: Publication) -> dict:
    description = publication.description
    tags = [x.lstrip("#") for x in publication.hashtags]
    if tags:
        description += "\n" + " ".join("#" + x for x in tags)
    return {
        "snippet": {"title": publication.title, "description": description, "tags": tags},
        "status": {
            "privacyStatus": publication.visibility,
            "selfDeclaredMadeForKids": publication.made_for_kids,
            "containsSyntheticMedia": publication.contains_synthetic_media,
        },
    }


def _raise_response(response: httpx.Response) -> None:
    if response.status_code in (408, 429) or response.status_code >= 500:
        retry_after = response.headers.get("retry-after")
        suffix = f" (Retry-After: {retry_after})" if retry_after else ""
        raise TransientPublishError("YouTube temporariamente indisponível" + suffix)
    if response.status_code >= 400:
        raise PermanentPublishError(f"YouTube rejeitou o envio (HTTP {response.status_code})")


def _validated_session_uri(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme != "https" or parsed.hostname not in ("www.googleapis.com", "youtube.googleapis.com"):
        raise PermanentPublishError("URI retomável do YouTube inválida")
    return value


def _completed(publication: Publication, response: httpx.Response) -> bool:
    if response.status_code not in (200, 201):
        return False
    try:
        remote_id = response.json()["id"]
    except (KeyError, ValueError, TypeError) as exc:
        raise TransientPublishError("Resposta final do YouTube sem identificador") from exc
    publication.remote_id = remote_id
    publication.remote_url = f"https://youtu.be/{remote_id}"
    publication.status = "processing"
    publication.error = None
    return True


def upload(db: Session, publication: Publication, account: Account, artifact: Path) -> None:
    if not artifact.is_file():
        raise PermanentPublishError("Artefato fixado não está disponível")
    token = _access_token(db, account)
    _ensure_not_cancelled(db, publication)
    total = artifact.stat().st_size
    headers = {"Authorization": f"Bearer {token}"}
    with httpx.Client(timeout=httpx.Timeout(30, read=120), trust_env=False) as client:
        if publication.upload_session_uri:
            session_uri = _validated_session_uri(decrypt(publication.upload_session_uri))
        else:
            response = client.post(
                UPLOAD_ENDPOINT,
                params={"uploadType": "resumable", "part": "snippet,status"},
                headers={**headers, "X-Upload-Content-Length": str(total), "X-Upload-Content-Type": "video/mp4"},
                json=_metadata(publication),
            )
            _ensure_not_cancelled(db, publication)
            _raise_response(response)
            session_uri = _validated_session_uri(response.headers.get("location") or "")
            if not session_uri:
                raise TransientPublishError("YouTube não retornou URI retomável")
            publication.upload_session_uri = encrypt(session_uri)
            publication.status = "uploading"
            db.commit()  # durable before the first media byte

        response = client.put(session_uri, headers={**headers, "Content-Length": "0", "Content-Range": f"bytes */{total}"})
        _ensure_not_cancelled(db, publication)
        if _completed(publication, response):
            db.commit(); return
        if response.status_code in (404, 410):
            publication.status = "needs_attention"
            publication.error = "Sessão retomável expirou; reconcilie antes de criar outro envio"
            db.commit()
            raise PermanentPublishError(publication.error)
        if response.status_code != 308:
            _raise_response(response)
        acknowledged = response.headers.get("range", "")
        offset = int(acknowledged.rsplit("-", 1)[1]) + 1 if "-" in acknowledged else 0

        chunk_size = 8 * 1024 * 1024
        with artifact.open("rb") as stream:
            stream.seek(offset)
            while offset < total:
                _ensure_not_cancelled(db, publication)
                chunk = stream.read(min(chunk_size, total - offset))
                end = offset + len(chunk) - 1
                response = client.put(
                    session_uri,
                    headers={**headers, "Content-Type": "video/mp4", "Content-Length": str(len(chunk)), "Content-Range": f"bytes {offset}-{end}/{total}"},
                    content=chunk,
                )
                _ensure_not_cancelled(db, publication)
                if _completed(publication, response):
                    db.commit(); return
                if response.status_code != 308:
                    _raise_response(response)
                acknowledged = response.headers.get("range", "")
                offset = int(acknowledged.rsplit("-", 1)[1]) + 1 if "-" in acknowledged else end + 1
    raise TransientPublishError("Envio terminou sem confirmação remota")


def reconcile_status(db: Session, publication: Publication, account: Account) -> None:
    token = _access_token(db, account)
    if not publication.remote_id:
        if not publication.upload_session_uri:
            raise PermanentPublishError("Publicação sem sessão ou identificador remoto")
        total = Path(publication.artifact_path).stat().st_size
        with httpx.Client(timeout=30, trust_env=False) as client:
            response = client.put(_validated_session_uri(decrypt(publication.upload_session_uri)), headers={"Authorization": f"Bearer {token}", "Content-Length": "0", "Content-Range": f"bytes */{total}"})
        if _completed(publication, response):
            db.commit(); return
        if response.status_code == 308:
            publication.status = "uploading"; db.commit(); return
        publication.status = "needs_attention"; publication.error = "Resultado remoto ambíguo; revisão manual necessária"; db.commit(); return
    with httpx.Client(timeout=30, trust_env=False) as client:
        response = client.get("https://www.googleapis.com/youtube/v3/videos", params={"part": "status,processingDetails", "id": publication.remote_id}, headers={"Authorization": f"Bearer {token}"})
    _raise_response(response)
    items = response.json().get("items", [])
    if not items:
        publication.status = "needs_attention"; publication.error = "O vídeo enviado não foi localizado no YouTube"
    else:
        item = items[0]
        processing = item.get("processingDetails", {}).get("processingStatus")
        if processing in ("failed", "terminated"):
            publication.status = "failed"; publication.error = "O processamento do YouTube falhou"
        elif processing in ("processing", "pending"):
            publication.status = "processing"
        else:
            publication.status = item.get("status", {}).get("privacyStatus") or "published"
            publication.error = None
    db.commit()


class YouTubePublisherAdapter(PublisherAdapter):
    def publish(self, *args, **kwargs) -> None:
        upload(*args, **kwargs)
