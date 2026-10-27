from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field, HttpUrl, field_validator, model_validator


class ORM(BaseModel): model_config = ConfigDict(from_attributes=True)
class UserOut(ORM): id: str; email: str
class AuthIn(BaseModel): email: EmailStr; password: str = Field(min_length=10, max_length=200)
class AuthOut(BaseModel): user: UserOut; csrf_token: str
class Style(BaseModel):
    font_size: int = Field(ge=16, le=96); color: str; outline_color: str; background_color: str
    position: Literal["bottom","center","top"]
    @field_validator("color", "outline_color")
    @classmethod
    def rgb(cls, value: str):
        import re
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", value): raise ValueError("cor deve usar #RRGGBB")
        return value.upper()
    @field_validator("background_color")
    @classmethod
    def rgba(cls, value: str):
        import re
        if not re.fullmatch(r"#[0-9A-Fa-f]{8}", value): raise ValueError("fundo deve usar #RRGGBBAA")
        return value.upper()
class Framing(BaseModel): mode: Literal["crop","contain"]; offset_x: float = Field(ge=0, le=1)
class CueOut(ORM): id: str; start_seconds: float; end_seconds: float; original_text: str; translated_text: str | None
class CueIn(BaseModel):
    id: str | None = None; start_seconds: float = Field(ge=0); end_seconds: float; original_text: str = Field(max_length=2000); translated_text: str | None = Field(default=None,max_length=2000)
    @model_validator(mode="after")
    def timing(self):
        if self.end_seconds <= self.start_seconds: raise ValueError("end_seconds deve ser maior que start_seconds")
        return self
class ClipOut(ORM):
    id: str; project_id: str; start_seconds: float; end_seconds: float; reason: str; score: float; status: str; revision: int
    subtitle_mode: str; framing: dict; style: dict; cues: list[CueOut]; artifact_url: str | None = None; srt_url: str | None = None; error: str | None
class ProjectOut(ORM):
    id: str; title: str; editing_instructions: str; status: str; stage: str; progress: float | None; error: str | None; duration_seconds: int
    source_duration: float | None; language: str | None; created_at: datetime; clips: list[ClipOut]
class ProjectCreate(BaseModel):
    title: str = Field(min_length=1,max_length=200); source_url: HttpUrl; duration_seconds: Literal[30,45,60]; rights_confirmed: Literal[True]
    editing_instructions: str = Field(default="",max_length=2000)
class ProjectLanguagePatch(BaseModel): language: str = Field(min_length=2,max_length=32,pattern=r"^[A-Za-z]{2,3}(?:-[A-Za-z]{2})?$")
class ManualClip(BaseModel): start_seconds: float = Field(ge=0)
class ClipPatch(BaseModel):
    start_seconds: float | None = Field(default=None,ge=0); subtitle_mode: Literal["original","translated","both"] | None = None
    framing: Framing | None = None; style: Style | None = None; cues: list[CueIn] | None = None
class Approve(BaseModel): revision: int
class AccountOut(BaseModel): id: str; platform: str; display_name: str; connected: bool; first_publish_confirmed: bool
class PublicationIn(BaseModel):
    clip_id: str; revision: int; account_id: str; title: str = Field(min_length=1,max_length=100); description: str = Field(default="",max_length=5000)
    hashtags: list[str] = Field(max_length=30); visibility: Literal["private","unlisted","public"]; made_for_kids: bool; contains_synthetic_media: bool
    scheduled_at: datetime | None = None; timezone: str = Field(min_length=1,max_length=64); confirm_first_publish: bool; confirmed: Literal[True]
class PublicationPatch(BaseModel): scheduled_at: datetime; timezone: str; confirmed: Literal[True]
class PublicationOut(ORM):
    id: str; clip_id: str; title: str; platform: str; status: str; scheduled_at: datetime | None; timezone: str
    remote_url: str | None; error: str | None; created_at: datetime
