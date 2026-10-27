export type UUID = string;

export interface User {
  id: UUID;
  email: string;
}

export interface AuthResponse {
  user: User;
  csrf_token: string;
}

export type SubtitleMode = "original" | "translated" | "both";
export type SubtitlePosition = "bottom" | "center" | "top";

export interface SubtitleStyle {
  font_size: number;
  color: string;
  outline_color: string;
  background_color: string;
  position: SubtitlePosition;
}

export interface Framing {
  mode: "crop" | "contain";
  /** Normalized horizontal offset 0..1 (0.5 = centered). */
  offset_x: number;
}

export interface Cue {
  id: UUID;
  /** Local clip time in seconds. */
  start_seconds: number;
  end_seconds: number;
  original_text: string;
  translated_text: string | null;
}

export interface Clip {
  id: UUID;
  project_id: UUID;
  start_seconds: number;
  end_seconds: number;
  reason: string;
  score: number;
  status: string;
  revision: number;
  subtitle_mode: SubtitleMode;
  framing: Framing;
  style: SubtitleStyle;
  cues: Cue[];
  artifact_url: string | null;
  srt_url: string | null;
  error: string | null;
}

export type ClipDuration = 30 | 45 | 60;

export const MAX_EDITING_INSTRUCTIONS = 2000;

export interface Project {
  id: UUID;
  title: string;
  editing_instructions: string;
  status: string;
  stage: string;
  progress: number | null;
  error: string | null;
  duration_seconds: number;
  source_duration: number | null;
  language: string | null;
  created_at: string;
  clips: Clip[];
}

export interface Account {
  id: UUID;
  platform: string;
  display_name: string;
  connected: boolean;
  first_publish_confirmed: boolean;
}

export type Visibility = "private" | "unlisted" | "public";

export interface PublicationCreate {
  clip_id: UUID;
  revision: number;
  account_id: UUID;
  title: string;
  description: string;
  hashtags: string[];
  visibility: Visibility;
  made_for_kids: boolean;
  contains_synthetic_media: boolean;
  scheduled_at: string | null;
  timezone: string;
  confirm_first_publish: boolean;
  confirmed: true;
}

export interface Publication {
  id: UUID;
  clip_id: UUID;
  title: string;
  platform: string;
  status: string;
  scheduled_at: string | null;
  timezone: string;
  remote_url: string | null;
  error: string | null;
  created_at: string;
}

export interface ClipPatch {
  start_seconds?: number;
  subtitle_mode?: SubtitleMode;
  framing?: Framing;
  style?: SubtitleStyle;
  cues?: Cue[];
}

export interface Capabilities {
  youtube?: boolean;
  gemini?: boolean;
  token_encryption?: boolean;
  ffmpeg?: boolean;
  ffprobe?: boolean;
  whisper_model?: string;
  [key: string]: unknown;
}
