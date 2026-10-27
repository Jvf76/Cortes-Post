import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base


def uid() -> str: return str(uuid.uuid4())
def now() -> datetime: return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    csrf_hash: Mapped[str] = mapped_column(String(64))
    # The CSRF value is not an authentication credential. Keeping it server-side
    # lets /auth/me return one stable token to every tab in the same session.
    csrf_token: Mapped[str] = mapped_column(String(128))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    editing_instructions: Mapped[str] = mapped_column(Text, default="")
    source_url: Mapped[str | None] = mapped_column(Text)
    source_path: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="queued")
    stage: Mapped[str] = mapped_column(String(32), default="importing")
    progress: Mapped[float | None] = mapped_column(Float)
    error: Mapped[str | None] = mapped_column(Text)
    duration_seconds: Mapped[int] = mapped_column(Integer)
    source_duration: Mapped[float | None] = mapped_column(Float)
    language: Mapped[str | None] = mapped_column(String(32))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    clips: Mapped[list["Clip"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    transcript: Mapped[list["TranscriptSegment"]] = relationship(back_populates="project", cascade="all, delete-orphan", order_by="TranscriptSegment.start_seconds")


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    start_seconds: Mapped[float] = mapped_column(Float)
    end_seconds: Mapped[float] = mapped_column(Float)
    original_text: Mapped[str] = mapped_column(Text)
    translated_text: Mapped[str | None] = mapped_column(Text)
    project: Mapped[Project] = relationship(back_populates="transcript")


class Clip(Base):
    __tablename__ = "clips"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    start_seconds: Mapped[float] = mapped_column(Float)
    end_seconds: Mapped[float] = mapped_column(Float)
    reason: Mapped[str] = mapped_column(Text, default="Seleção manual")
    score: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(32), default="draft")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    approved_revision: Mapped[int | None] = mapped_column(Integer)
    approved_snapshot: Mapped[dict | None] = mapped_column(JSON)
    subtitle_mode: Mapped[str] = mapped_column(String(16), default="original")
    framing: Mapped[dict] = mapped_column(JSON, default=lambda: {"mode":"crop","offset_x":0.5})
    style: Mapped[dict] = mapped_column(JSON, default=lambda: {"font_size":48,"color":"#FFFFFF","outline_color":"#000000","background_color":"#00000080","position":"bottom"})
    artifact_path: Mapped[str | None] = mapped_column(Text)
    srt_path: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    project: Mapped[Project] = relationship(back_populates="clips")
    cues: Mapped[list["Cue"]] = relationship(back_populates="clip", cascade="all, delete-orphan", order_by="Cue.start_seconds")


class Cue(Base):
    __tablename__ = "cues"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    clip_id: Mapped[str] = mapped_column(ForeignKey("clips.id", ondelete="CASCADE"), index=True)
    start_seconds: Mapped[float] = mapped_column(Float)
    end_seconds: Mapped[float] = mapped_column(Float)
    original_text: Mapped[str] = mapped_column(Text)
    translated_text: Mapped[str | None] = mapped_column(Text)
    clip: Mapped[Clip] = relationship(back_populates="cues")


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    platform: Mapped[str] = mapped_column(String(32), default="youtube")
    display_name: Mapped[str] = mapped_column(String(200))
    access_token: Mapped[bytes] = mapped_column(LargeBinary)
    refresh_token: Mapped[bytes | None] = mapped_column(LargeBinary)
    token_expiry: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_publish_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    publications: Mapped[list["Publication"]] = relationship(back_populates="account")


class OAuthState(Base):
    __tablename__ = "oauth_states"
    state_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    code_verifier: Mapped[bytes] = mapped_column(LargeBinary)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Publication(Base):
    __tablename__ = "publications"
    __table_args__ = (UniqueConstraint("clip_id", "revision", "account_id", "idempotency_key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    clip_id: Mapped[str] = mapped_column(ForeignKey("clips.id", ondelete="RESTRICT"))
    revision: Mapped[int] = mapped_column(Integer)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id", ondelete="RESTRICT"))
    title: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, default="")
    hashtags: Mapped[list] = mapped_column(JSON, default=list)
    visibility: Mapped[str] = mapped_column(String(16))
    made_for_kids: Mapped[bool] = mapped_column(Boolean)
    contains_synthetic_media: Mapped[bool] = mapped_column(Boolean)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    timezone: Mapped[str] = mapped_column(String(64))
    platform: Mapped[str] = mapped_column(String(32), default="youtube")
    status: Mapped[str] = mapped_column(String(32), default="scheduled")
    remote_url: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    upload_session_uri: Mapped[bytes | None] = mapped_column(LargeBinary)
    artifact_path: Mapped[str] = mapped_column(Text, default="")
    remote_id: Mapped[str | None] = mapped_column(String(128))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    account: Mapped[Account] = relationship(back_populates="publications")


class Outbox(Base):
    __tablename__ = "outbox"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    kind: Mapped[str] = mapped_column(String(64))
    object_id: Mapped[str] = mapped_column(String(36), index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_token: Mapped[str | None] = mapped_column(String(64), index=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
