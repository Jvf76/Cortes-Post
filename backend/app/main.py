import hashlib, os, re, secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import httpx
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload
from .config import get_settings
from .db import Base, engine, get_db
from .integrations import publication_key
from .models import Account, Clip, Cue, OAuthState, Outbox, Project, Publication, Session as AuthSession, TranscriptSegment, User
from .schemas import AccountOut, Approve, AuthIn, AuthOut, ClipOut, ClipPatch, ManualClip, ProjectCreate, ProjectLanguagePatch, ProjectOut, PublicationIn, PublicationOut, PublicationPatch, UserOut
from .security import COOKIE, create_session, current_user, decrypt, digest, encrypt, hash_password, require_csrf, validate_https_public_url, verify_password
from .worker import dispatch_outbox, enqueue  # enqueue retained as a public test seam
from .youtube import oauth_flow
from .youtube_import import canonicalize_youtube_url

settings=get_settings()
app=FastAPI(title="CortesAutomaticos API",version="1.0.0")

@app.on_event("startup")
def startup(): settings.storage_dir.mkdir(parents=True,exist_ok=True)

def set_cookie(response: Response, raw: str):
    response.set_cookie(COOKIE,raw,max_age=settings.session_days*86400,httponly=True,secure=settings.cookie_secure,samesite="lax",path="/")
def clip_out(c: Clip) -> dict:
    data=ClipOut.model_validate(c).model_dump()
    data["artifact_url"]=f"/api/clips/{c.id}/download" if c.artifact_path else None
    data["srt_url"]=f"/api/clips/{c.id}/subtitles" if c.srt_path else None
    return data
def project_out(p: Project) -> dict:
    data=ProjectOut.model_validate(p).model_dump(); data["clips"]=[clip_out(c) for c in p.clips]; return data
def owned_project(db: Session,user: User,id: str) -> Project:
    p=db.scalar(select(Project).options(selectinload(Project.clips).selectinload(Clip.cues)).where(Project.id==id,Project.user_id==user.id,Project.deleted_at.is_(None)))
    if not p: raise HTTPException(404,"Projeto não encontrado")
    return p
def owned_clip(db: Session,user: User,id: str) -> Clip:
    c=db.scalar(select(Clip).options(selectinload(Clip.cues),selectinload(Clip.project)).join(Project).where(Clip.id==id,Project.user_id==user.id,Project.deleted_at.is_(None)))
    if not c: raise HTTPException(404,"Corte não encontrado")
    return c
def queue(db: Session,kind: str,object_id: str):
    event=Outbox(kind=kind,object_id=object_id); db.add(event); db.commit()
    dispatch_outbox(event.id)

@app.get("/api/health")
def health(db: Session=Depends(get_db)):
    try: db.execute(select(1)); database=True
    except Exception: database=False
    return {"status":"ok" if database else "degraded","database":database}
@app.get("/api/capabilities")
def capabilities():
    import shutil
    return {"youtube":settings.youtube_configured,"gemini":bool(settings.gemini_api_key),"token_encryption":bool(settings.token_encryption_key),"ffmpeg":bool(shutil.which(settings.ffmpeg_binary)),"ffprobe":bool(shutil.which(settings.ffprobe_binary)),"whisper_model":settings.whisper_model}

@app.post("/api/auth/register",response_model=AuthOut,status_code=201)
def register(body: AuthIn,response: Response,db: Session=Depends(get_db)):
    email=body.email.lower()
    if db.scalar(select(User).where(User.email==email)): raise HTTPException(409,"E-mail já cadastrado")
    user=User(email=email,password_hash=hash_password(body.password)); db.add(user); db.commit(); raw,csrf=create_session(db,user); set_cookie(response,raw)
    return {"user":user,"csrf_token":csrf}
@app.post("/api/auth/login",response_model=AuthOut)
def login(body: AuthIn,response: Response,db: Session=Depends(get_db)):
    user=db.scalar(select(User).where(User.email==body.email.lower()))
    if not user or not verify_password(user.password_hash,body.password): raise HTTPException(401,"E-mail ou senha inválidos")
    raw,csrf=create_session(db,user); set_cookie(response,raw); return {"user":user,"csrf_token":csrf}
@app.get("/api/auth/me",response_model=AuthOut)
def me(request: Request,user: User=Depends(current_user)):
    session=request.state.auth_session
    if not session.csrf_token:  # one-time compatibility for pre-0002 sessions
        session.csrf_token=secrets.token_urlsafe(32); session.csrf_hash=digest(session.csrf_token)
        from sqlalchemy.orm import object_session
        object_session(session).commit()
    return {"user":user,"csrf_token":session.csrf_token}
@app.post("/api/auth/logout",status_code=204)
def logout(request: Request,response: Response,user: User=Depends(require_csrf),db: Session=Depends(get_db)):
    db.delete(request.state.auth_session); db.commit(); response.delete_cookie(COOKIE,path="/")

@app.get("/api/projects")
def projects(user: User=Depends(current_user),db: Session=Depends(get_db)):
    rows=db.scalars(select(Project).options(selectinload(Project.clips).selectinload(Clip.cues)).where(Project.user_id==user.id,Project.deleted_at.is_(None)).order_by(Project.created_at.desc())).all()
    return [project_out(x) for x in rows]
@app.post("/api/projects",status_code=201)
def create_project(body: ProjectCreate,user: User=Depends(require_csrf),db: Session=Depends(get_db)):
    source_url=str(body.source_url)
    canonical=canonicalize_youtube_url(source_url)
    if canonical is None: validate_https_public_url(source_url)
    else: source_url=canonical
    p=Project(user_id=user.id,title=body.title,editing_instructions=body.editing_instructions,source_url=source_url,duration_seconds=body.duration_seconds,stage="importing",progress=0)
    db.add(p); db.commit(); db.refresh(p); queue(db,"process_project",p.id); return project_out(p)
@app.post("/api/projects/upload",status_code=201)
def upload_project(title: str=Form(...),duration_seconds: int=Form(...),rights_confirmed: bool=Form(...),editing_instructions: str=Form("",max_length=2000),file: UploadFile=File(...),user: User=Depends(require_csrf),db: Session=Depends(get_db)):
    if not rights_confirmed: raise HTTPException(422,"É necessário confirmar os direitos")
    if duration_seconds not in (30,45,60): raise HTTPException(422,"Duração deve ser 30, 45 ou 60")
    if file.content_type not in ("video/mp4","application/octet-stream"): raise HTTPException(415,"Envie um arquivo MP4")
    p=Project(user_id=user.id,title=title[:200],editing_instructions=editing_instructions,duration_seconds=duration_seconds,stage="importing",progress=0); db.add(p); db.flush()
    path=settings.storage_dir/user.id/p.id/"source.mp4"; path.parent.mkdir(parents=True,exist_ok=True); size=0
    try:
        with path.open("xb") as out:
            while chunk:=file.file.read(1024*1024):
                size+=len(chunk)
                if size>settings.max_upload_bytes: raise HTTPException(413,"Arquivo excede o limite configurado")
                out.write(chunk)
    except Exception: path.unlink(missing_ok=True); db.rollback(); raise
    p.source_path=str(path); db.commit(); db.refresh(p); queue(db,"process_project",p.id); return project_out(p)
@app.get("/api/projects/{id}")
def get_project(id: str,user: User=Depends(current_user),db: Session=Depends(get_db)): return project_out(owned_project(db,user,id))
@app.delete("/api/projects/{id}",status_code=204)
def delete_project(id: str,user: User=Depends(require_csrf),db: Session=Depends(get_db)):
    p=owned_project(db,user,id); p.deleted_at=datetime.now(timezone.utc); p.status="cancelled"
    db.query(Publication).filter(Publication.clip_id.in_(select(Clip.id).where(Clip.project_id==p.id)),Publication.status.in_(["scheduled","queued","uploading"])).update({"status":"cancelled"},synchronize_session=False); db.commit(); queue(db,"cleanup_project",p.id)
@app.post("/api/projects/{id}/retry")
def retry_project(id: str,user: User=Depends(require_csrf),db: Session=Depends(get_db)):
    p=owned_project(db,user,id)
    if p.status!="failed": raise HTTPException(409,"Somente projetos com falha podem ser repetidos")
    p.status="queued"; p.error=None; p.progress=None; db.commit(); queue(db,"process_project",p.id); return project_out(p)

@app.patch("/api/projects/{id}/language")
def patch_project_language(id: str,body: ProjectLanguagePatch,user: User=Depends(require_csrf),db: Session=Depends(get_db)):
    p=owned_project(db,user,id); p.language=body.language; db.commit(); return project_out(p)

def range_file(path: Path,request: Request,media_type: str):
    if not path.is_file(): raise HTTPException(404,"Arquivo não encontrado")
    size=path.stat().st_size; header=request.headers.get("range")
    if not header: return FileResponse(path,media_type=media_type,filename=path.name)
    match=re.fullmatch(r"bytes=(\d*)-(\d*)",header)
    if not match: raise HTTPException(416,"Range inválido",headers={"Content-Range":f"bytes */{size}"})
    if not match.group(1) and match.group(2):
        length=int(match.group(2)); start=max(0,size-length); end=size-1
    else:
        start=int(match.group(1) or 0); end=min(int(match.group(2) or size-1),size-1)
    if start>end or start>=size: raise HTTPException(416,"Range inválido",headers={"Content-Range":f"bytes */{size}"})
    def body():
        with path.open("rb") as f:
            f.seek(start); remaining=end-start+1
            while remaining:
                chunk=f.read(min(1024*1024,remaining)); remaining-=len(chunk); yield chunk
    return StreamingResponse(body(),206,{"Content-Range":f"bytes {start}-{end}/{size}","Accept-Ranges":"bytes","Content-Length":str(end-start+1)},media_type)
@app.get("/api/projects/{id}/source")
def source(id: str,request: Request,user: User=Depends(current_user),db: Session=Depends(get_db)):
    p=owned_project(db,user,id)
    if not p.source_path: raise HTTPException(409,"Fonte ainda não importada")
    return range_file(Path(p.source_path),request,"video/mp4")

@app.post("/api/projects/{id}/clips",status_code=201)
def manual_clip(id: str,body: ManualClip,user: User=Depends(require_csrf),db: Session=Depends(get_db)):
    p=owned_project(db,user,id)
    if p.source_duration is None or body.start_seconds+p.duration_seconds>p.source_duration: raise HTTPException(422,"O corte ultrapassa a duração da fonte")
    c=Clip(project_id=p.id,start_seconds=body.start_seconds,end_seconds=body.start_seconds+p.duration_seconds); db.add(c); db.flush()
    _replace_cues_from_transcript(db,c)
    db.commit(); return clip_out(owned_clip(db,user,c.id))

def _replace_cues_from_transcript(db: Session,c: Clip):
    db.query(Cue).filter(Cue.clip_id==c.id).delete(synchronize_session=False)
    rows=db.scalars(select(TranscriptSegment).where(TranscriptSegment.project_id==c.project_id,TranscriptSegment.end_seconds>c.start_seconds,TranscriptSegment.start_seconds<c.end_seconds).order_by(TranscriptSegment.start_seconds)).all()
    for row in rows:
        db.add(Cue(clip_id=c.id,start_seconds=max(row.start_seconds,c.start_seconds)-c.start_seconds,end_seconds=min(row.end_seconds,c.end_seconds)-c.start_seconds,original_text=row.original_text,translated_text=row.translated_text))
    db.flush(); db.expire(c,["cues"])
@app.get("/api/clips/{id}")
def get_clip(id: str,user: User=Depends(current_user),db: Session=Depends(get_db)): return clip_out(owned_clip(db,user,id))
@app.patch("/api/clips/{id}")
def patch_clip(id: str,body: ClipPatch,user: User=Depends(require_csrf),db: Session=Depends(get_db)):
    c=owned_clip(db,user,id); values=body.model_dump(exclude_unset=True)
    if "start_seconds" in values:
        if values["start_seconds"]+(c.end_seconds-c.start_seconds)>c.project.source_duration: raise HTTPException(422,"O corte ultrapassa a fonte")
        duration=c.end_seconds-c.start_seconds; c.start_seconds=values.pop("start_seconds"); c.end_seconds=c.start_seconds+duration
        if "cues" not in values: _replace_cues_from_transcript(db,c)
    cues=values.pop("cues",None)
    for key,value in values.items(): setattr(c,key,value)
    if cues is not None:
        db.query(Cue).filter(Cue.clip_id==c.id).delete()
        duration=c.end_seconds-c.start_seconds
        for cue in cues:
            if cue["end_seconds"]>duration: raise HTTPException(422,"Legenda fora do corte")
            cue.pop("id",None); db.add(Cue(clip_id=c.id,**cue))
        db.flush(); db.expire(c,["cues"])
    c.revision+=1; c.approved_revision=None; c.approved_snapshot=None; c.status="draft"; c.artifact_path=None; c.srt_path=None; c.error=None; db.commit(); return clip_out(owned_clip(db,user,id))
@app.post("/api/clips/{id}/approve")
def approve_clip(id: str,body: Approve,user: User=Depends(require_csrf),db: Session=Depends(get_db)):
    c=owned_clip(db,user,id)
    if body.revision!=c.revision: raise HTTPException(409,"A revisão mudou; revise novamente")
    db.execute(select(Project.id).where(Project.id==c.project_id).with_for_update())
    rendered=db.scalar(select(func.count()).select_from(Clip).where(Clip.project_id==c.project_id,Clip.status.in_(["queued","rendering","ready"])))
    if rendered>=settings.max_rendered_clips and c.status not in ("queued","rendering","ready"): raise HTTPException(409,"Limite de cortes renderizados atingido")
    c.approved_revision=c.revision
    c.approved_snapshot={"revision":c.revision,"start_seconds":c.start_seconds,"end_seconds":c.end_seconds,"subtitle_mode":c.subtitle_mode,"framing":c.framing,"style":c.style,"cues":[{"start_seconds":x.start_seconds,"end_seconds":x.end_seconds,"original_text":x.original_text,"translated_text":x.translated_text} for x in c.cues]}
    c.status="queued"; db.commit(); queue(db,"render_clip",c.id); return clip_out(c)
@app.get("/api/clips/{id}/download")
def clip_download(id: str,request: Request,user: User=Depends(current_user),db: Session=Depends(get_db)):
    c=owned_clip(db,user,id)
    if not c.artifact_path: raise HTTPException(409,"Renderização ainda não disponível")
    return range_file(Path(c.artifact_path),request,"video/mp4")
@app.get("/api/clips/{id}/subtitles")
def subtitles(id: str,user: User=Depends(current_user),db: Session=Depends(get_db)):
    c=owned_clip(db,user,id)
    if not c.srt_path: raise HTTPException(409,"Legendas ainda não disponíveis")
    return FileResponse(c.srt_path,media_type="application/x-subrip",filename=f"{id}.srt")

@app.get("/api/accounts",response_model=list[AccountOut])
def accounts(user: User=Depends(current_user),db: Session=Depends(get_db)):
    return [{"id":a.id,"platform":a.platform,"display_name":a.display_name,"connected":a.revoked_at is None,"first_publish_confirmed":a.first_publish_confirmed} for a in db.scalars(select(Account).where(Account.user_id==user.id)).all()]
@app.get("/api/accounts/youtube/connect")
def youtube_connect(request: Request,user: User=Depends(current_user),db: Session=Depends(get_db)):
    if not settings.youtube_configured: raise HTTPException(503,"OAuth do YouTube não configurado")
    raw=secrets.token_urlsafe(32); verifier=secrets.token_urlsafe(64)
    import base64
    challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    db.add(OAuthState(state_hash=digest(raw),user_id=user.id,session_id=request.state.auth_session.id,code_verifier=encrypt(verifier),expires_at=datetime.now(timezone.utc)+timedelta(minutes=10))); db.commit()
    flow=oauth_flow(raw); url,_=flow.authorization_url(access_type="offline",include_granted_scopes="true",prompt="consent",code_challenge=challenge,code_challenge_method="S256")
    return {"authorization_url":url}
@app.get("/api/accounts/youtube/callback")
def youtube_callback(state: str,code: str,request: Request,db: Session=Depends(get_db)):
    bound=db.get(OAuthState,digest(state)); current=datetime.now(timezone.utc)
    bound_expiry=bound.expires_at.replace(tzinfo=timezone.utc) if bound and bound.expires_at.tzinfo is None else (bound.expires_at if bound else current)
    raw_session=request.cookies.get(COOKIE); auth_session=db.get(AuthSession,digest(raw_session)) if raw_session else None
    if not bound or bound_expiry<=current or not auth_session or bound.session_id!=auth_session.id:
        return RedirectResponse(settings.frontend_url+"/contas?error=invalid_state",303)
    user_id=bound.user_id; verifier=decrypt(bound.code_verifier); db.delete(bound); db.commit()
    try:
        flow=oauth_flow(state); flow.fetch_token(code=code,code_verifier=verifier); creds=flow.credentials
        with httpx.Client(timeout=15,trust_env=False) as client:
            response=client.get("https://www.googleapis.com/youtube/v3/channels",params={"part":"snippet","mine":"true"},headers={"Authorization":f"Bearer {creds.token}"})
            response.raise_for_status(); channels=response.json().get("items",[])
        if not channels: return RedirectResponse(settings.frontend_url+"/contas?error=no_channel",303)
        display=channels[0].get("snippet",{}).get("title") or "Canal YouTube"
        account=Account(user_id=user_id,display_name=display,access_token=encrypt(creds.token),refresh_token=encrypt(creds.refresh_token) if creds.refresh_token else None,token_expiry=creds.expiry)
        db.add(account); db.commit(); return RedirectResponse(settings.frontend_url+"/contas?connected=1",303)
    except Exception:
        return RedirectResponse(settings.frontend_url+"/contas?error=oauth_failed",303)
@app.delete("/api/accounts/{id}",status_code=204)
def disconnect(id: str,user: User=Depends(require_csrf),db: Session=Depends(get_db)):
    a=db.scalar(select(Account).where(Account.id==id,Account.user_id==user.id).with_for_update())
    if not a: raise HTTPException(404,"Conta não encontrada")
    token=decrypt(a.access_token)
    db.query(Publication).filter(Publication.account_id==a.id,Publication.status.in_(["scheduled","queued","uploading"])).update({"status":"cancelled","error":"Conta desconectada"},synchronize_session=False)
    a.access_token=b""; a.refresh_token=None; a.revoked_at=datetime.now(timezone.utc); db.commit()
    try:
        with httpx.Client(timeout=10,trust_env=False) as client:
            response=client.post("https://oauth2.googleapis.com/revoke",params={"token":token})
            response.raise_for_status()
    except Exception:
        db.query(Publication).filter(Publication.account_id==a.id,Publication.status=="cancelled").update({"error":"Conta desconectada; revogação remota incerta"},synchronize_session=False); db.commit()

@app.get("/api/publications",response_model=list[PublicationOut])
def publications(user: User=Depends(current_user),db: Session=Depends(get_db)): return db.scalars(select(Publication).where(Publication.user_id==user.id).order_by(Publication.created_at.desc())).all()
def validate_schedule(value: datetime | None,timezone_name: str):
    try: ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError: raise HTTPException(422,"Fuso horário inválido")
    if value and value.tzinfo is None: raise HTTPException(422,"scheduled_at deve conter fuso horário")
@app.post("/api/publications",response_model=PublicationOut,status_code=201)
def create_publication(body: PublicationIn,user: User=Depends(require_csrf),db: Session=Depends(get_db)):
    validate_schedule(body.scheduled_at,body.timezone); c=owned_clip(db,user,body.clip_id)
    a=db.scalar(select(Account).where(Account.id==body.account_id,Account.user_id==user.id,Account.revoked_at.is_(None)).with_for_update())
    if not a: raise HTTPException(404,"Conta não encontrada")
    if c.revision!=body.revision or c.status!="ready" or not c.artifact_path: raise HTTPException(409,"A revisão fixada precisa estar renderizada")
    if not a.first_publish_confirmed and not body.confirm_first_publish: raise HTTPException(422,"Confirme a primeira publicação desta conta")
    key=publication_key(user.id,c.id,body.revision,a.id,body.title,body.scheduled_at,body.model_dump(mode="json",exclude={"confirmed","confirm_first_publish"}))
    existing=db.scalar(select(Publication).where(Publication.user_id==user.id,Publication.idempotency_key==key))
    if existing: return existing
    if body.confirm_first_publish: a.first_publish_confirmed=True
    pub=Publication(user_id=user.id,idempotency_key=key,artifact_path=c.artifact_path,platform="youtube",status="scheduled" if body.scheduled_at and body.scheduled_at>datetime.now(timezone.utc) else "queued",**body.model_dump(exclude={"confirm_first_publish","confirmed"}))
    db.add(pub); db.commit(); db.refresh(pub)
    if pub.status=="queued": queue(db,"publish",pub.id)
    return pub
@app.post("/api/publications/{id}/cancel")
def cancel_publication(id: str,user: User=Depends(require_csrf),db: Session=Depends(get_db)):
    p=db.scalar(select(Publication).where(Publication.id==id,Publication.user_id==user.id))
    if not p: raise HTTPException(404,"Publicação não encontrada")
    if p.status not in ("scheduled","queued"): raise HTTPException(409,"Publicação já está sendo enviada ou concluída")
    p.status="cancelled"; db.commit(); return p
@app.patch("/api/publications/{id}",response_model=PublicationOut)
def patch_publication(id: str,body: PublicationPatch,user: User=Depends(require_csrf),db: Session=Depends(get_db)):
    validate_schedule(body.scheduled_at,body.timezone); p=db.scalar(select(Publication).where(Publication.id==id,Publication.user_id==user.id))
    if not p: raise HTTPException(404,"Publicação não encontrada")
    if p.status!="scheduled": raise HTTPException(409,"Somente agendamentos pendentes podem ser alterados")
    p.scheduled_at=body.scheduled_at; p.timezone=body.timezone; db.commit(); return p
