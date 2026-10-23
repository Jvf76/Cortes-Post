# CortesAutomaticos — Fase 1

**Retomada:** leia também `docs/REVIEW.md` antes de continuar. Ele registra correções obrigatórias encontradas na primeira implementação e critérios adicionais de validação.

## Ownership
Coordinator owns root infrastructure/docs and integration. Antigravity owns `frontend/`. Codex Sol 5.6 owns `backend/`. Do not edit another owner's files without coordinating. No secrets, no real publication in tests, no source copying from Concat.

## Product
Portuguese-Brazil interface. Multi-user authenticated app: import authorized MP4 from direct HTTPS URL or file; transcribe with timed segments; propose up to 5 clips, duration exactly 30/45/60s; human reviews text, original/pt-BR/both subtitles, style and framing; explicitly approves immutable revision before render; final MP4 1080x1920 H264/AAC/yuv420p/30fps/faststart with burned subtitles and original audio; preview/download/SRT; OAuth YouTube publication now or scheduled. Instagram/TikTok unavailable, voice disabled interface only, Concat assessment only. No scraping/platform downloaders. Limit 2GB, 60min, 3 rendered clips per project (configurable).

## Architecture
Next.js React TypeScript frontend, FastAPI Python backend, PostgreSQL SQLAlchemy Alembic, Celery Redis workers, Beat database scheduler, private S3-compatible storage (local filesystem option for development), FFmpeg/ffprobe/libass, faster-whisper, Gemini official SDK structured suggestions/translation. Models configured through server env. Docker Compose production-like local run. External integrations must fail clearly if not configured; mocks only tests.

## API contract v1
Base `/api`, JSON snake_case, UUID strings, timestamps ISO8601 UTC. Auth session HttpOnly cookie, CSRF header `X-CSRF-Token` for mutating authenticated requests. `GET /api/auth/me` returns `{user:{id,email},csrf_token}` or 401. Errors `{detail:string}`. Lists return JSON arrays. Poll project detail for durable progress (SSE optional). Frontend API base through same-origin Next rewrite to backend; never expose server secrets.

- POST /auth/register and /auth/login `{email,password}` -> `{user:{id,email},csrf_token}`; POST /auth/logout.
- GET /projects -> Project[]; POST /projects `{title,source_url,duration_seconds,rights_confirmed:true}` -> Project; POST /projects/upload multipart `file,title,duration_seconds,rights_confirmed` -> Project.
- Project `{id,title,status,stage,progress:number|null,error:string|null,duration_seconds,source_duration:number|null,language:string|null,created_at,clips:Clip[]}`. GET /projects/{id}; DELETE /projects/{id}; POST /projects/{id}/retry; GET /projects/{id}/source -> authenticated media response (Range) or private signed redirect.
- Clip `{id,project_id,start_seconds,end_seconds,reason,score,status,revision,subtitle_mode,framing,style,cues:Cue[],artifact_url:string|null,srt_url:string|null,error:string|null}`.
- Cue `{id,start_seconds,end_seconds,original_text,translated_text}` uses local clip times. style `{font_size:number,color:string,outline_color:string,background_color:string,position:'bottom'|'center'|'top'}`; framing `{mode:'crop'|'contain',offset_x:number}` where offset_x is normalized 0..1. Subtitle mode `original|translated|both`.
- POST /projects/{id}/clips `{start_seconds}` -> Clip (manual selection, project duration).
- PATCH /clips/{id} `{start_seconds?,subtitle_mode?,framing?,style?,cues?}` -> Clip, increments revision and invalidates approval.
- POST /clips/{id}/approve `{revision}` -> Clip (explicit approve+enqueue render). GET /clips/{id}; GET /clips/{id}/download; GET /clips/{id}/subtitles.
- GET /accounts -> Account[] `{id,platform,display_name,connected,first_publish_confirmed}`; GET /accounts/youtube/connect -> `{authorization_url}`; GET /accounts/youtube/callback OAuth redirect; DELETE /accounts/{id} disconnect/revoke.
- GET /publications -> Publication[]; POST /publications `{clip_id,revision,account_id,title,description,hashtags:string[],visibility:'private'|'unlisted'|'public',made_for_kids:boolean,contains_synthetic_media:boolean,scheduled_at:string|null,timezone:string,confirm_first_publish:boolean,confirmed:true}` -> Publication.
- Publication `{id,clip_id,title,platform,status,scheduled_at,timezone,remote_url:string|null,error:string|null,created_at}`. POST /publications/{id}/cancel. PATCH /publications/{id} `{scheduled_at,timezone,confirmed:true}` only before sending.
- GET /health and /capabilities for service health and configured integrations (booleans, no secrets).

## Critical invariants
Contract clarification: progress is always 0..100 (null if indeterminate). Project statuses queued/processing/ready/failed/cancelled; stages importing/transcribing/suggesting/ready. Clip statuses draft/queued/rendering/ready/failed. Publication statuses scheduled/queued/uploading/processing/published/private/unlisted/failed/needs_attention/cancelled. OAuth returns to FRONTEND_URL/contas?connected=1 or ?error=<safe_code>. Frontend uses a streaming runtime route-handler proxy (BACKEND_URL), preserving Range, session cookies and manual redirects, fixed upstream only.

Tenant authorization on every object. Strong hashed passwords via established library, sessions and CSRF validation, secure cookie production. SSRF block non-public IPs (IPv4/6), DNS rebinding, credentials, redirects to unsafe targets and non-HTTPS; streaming byte limits. Isolated FFmpeg argv no shell, resource/time limits. Transcripts untrusted; validate all LLM output. Separate translation blocks, preserve human edits, timing rebased to clip. Render only approved revision, immutable artifacts. Private storage, short-lived URLs, deletion invalidates pending tasks; retention protects pending publication artifacts.

OAuth state, exact redirect validation, least scopes, authenticated encrypted access+refresh tokens with env encryption key, refresh lock and revocation. Explicit first-account confirmation AND each publication confirmation. Pin revision and metadata. Resumable upload persist session; reconcile uncertain results, never blind duplicate upload. Distinguish uploaded/processing/published/private/unlisted/failed/needs_attention. Scheduled upload starts at chosen UTC time, user sees timezone, >15min overdue needs attention. Max 3 transient attempts with exponential backoff/jitter/Retry-After; permanent errors not retried. Outbox or equivalent durable enqueue reconciliation and DB locks. Cancellation and restart recovery. Genuine progress or null; no invented percentages.

## Deliverables and testing
Functional vertical workflow, meaningful tests (auth/isolation/SSRF/approval invalidation/real ffmpeg render/subtitle escaping/encryption/no token leak/scheduling/idempotency/disconnect), setup/env placeholders, pinned dependencies, migrations, owner report with executed tests and explicit external blockers. No actual social publishing without user confirmation. No paid API calls for testing unless credentials and authorization exist. Documentation ADRs and third-party inventory. YouTube credentials/model downloads/runtime availability are external dependencies to report honestly.
