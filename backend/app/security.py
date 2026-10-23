import hashlib, hmac, ipaddress, secrets, socket
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from argon2 import PasswordHasher
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session as DBSession
from .config import get_settings
from .db import get_db
from .models import Session, User

ph = PasswordHasher()
COOKIE = "cortes_session"

def hash_password(value: str) -> str: return ph.hash(value)
def verify_password(stored: str, value: str) -> bool:
    try: return ph.verify(stored, value)
    except Exception: return False
def digest(value: str) -> str: return hashlib.sha256(value.encode()).hexdigest()

def create_session(db: DBSession, user: User) -> tuple[str,str]:
    raw, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    db.add(Session(id=digest(raw), user_id=user.id, csrf_hash=digest(csrf), csrf_token=csrf, expires_at=datetime.now(timezone.utc)+timedelta(days=get_settings().session_days)))
    db.commit(); return raw, csrf

def current_user(request: Request, db: DBSession=Depends(get_db)) -> User:
    raw=request.cookies.get(COOKIE)
    session=db.get(Session,digest(raw)) if raw else None
    now=datetime.now(timezone.utc)
    expiry=session.expires_at.replace(tzinfo=timezone.utc) if session and session.expires_at.tzinfo is None else (session.expires_at if session else now)
    if not session or expiry <= now: raise HTTPException(401,"Não autenticado")
    user=db.get(User,session.user_id)
    if not user: raise HTTPException(401,"Não autenticado")
    request.state.auth_session=session; return user

def require_csrf(request: Request, user: User=Depends(current_user)) -> User:
    token=request.headers.get("X-CSRF-Token","")
    if not hmac.compare_digest(digest(token), request.state.auth_session.csrf_hash): raise HTTPException(403,"Token CSRF inválido")
    return user

def resolve_https_public_url(url: str) -> tuple[str, int, list[str]]:
    parsed=urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password: raise HTTPException(422,"A origem deve ser uma URL HTTPS pública sem credenciais")
    try: addresses={x[4][0] for x in socket.getaddrinfo(parsed.hostname,parsed.port or 443,type=socket.SOCK_STREAM)}
    except socket.gaierror: raise HTTPException(422,"Não foi possível resolver a origem")
    if not addresses: raise HTTPException(422,"Origem sem endereço")
    for addr in addresses:
        ip=ipaddress.ip_address(addr.split("%")[0])
        if not ip.is_global: raise HTTPException(422,"A origem aponta para uma rede não pública")

    return parsed.hostname, parsed.port or 443, sorted(addresses)

def validate_https_public_url(url: str) -> None:
    resolve_https_public_url(url)

def cipher() -> Fernet:
    key=get_settings().token_encryption_key
    if not key: raise RuntimeError("TOKEN_ENCRYPTION_KEY não configurada")
    try: return Fernet(key.encode())
    except (ValueError,TypeError) as exc: raise RuntimeError("TOKEN_ENCRYPTION_KEY inválida") from exc
def encrypt(value: str) -> bytes: return cipher().encrypt(value.encode())
def decrypt(value: bytes) -> str:
    try: return cipher().decrypt(value).decode()
    except InvalidToken as exc: raise RuntimeError("Token OAuth não pôde ser descriptografado") from exc
