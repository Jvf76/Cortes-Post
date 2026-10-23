import type { Clip, ClipPatch, Cue, Framing, SubtitleMode, SubtitleStyle } from "./types";

export interface ClipDraft {
  start_seconds: number;
  subtitle_mode: SubtitleMode;
  framing: Framing;
  style: SubtitleStyle;
  cues: Cue[];
}

export function draftFromClip(clip: Clip): ClipDraft {
  return {
    start_seconds: clip.start_seconds,
    subtitle_mode: clip.subtitle_mode,
    framing: { ...clip.framing },
    style: { ...clip.style },
    cues: clip.cues.map((c) => ({ ...c })),
  };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function changedFields(clip: Clip, draft: ClipDraft) {
  return {
    start: Math.abs(clip.start_seconds - draft.start_seconds) > 1e-6,
    mode: clip.subtitle_mode !== draft.subtitle_mode,
    framing: !sameJson(clip.framing, draft.framing),
    style: !sameJson(clip.style, draft.style),
    cues: !sameJson(clip.cues, draft.cues),
  };
}

export function isDirty(clip: Clip, draft: ClipDraft): boolean {
  return Object.values(changedFields(clip, draft)).some(Boolean);
}

/** Only changed fields are sent, so untouched data (and human edits) are preserved. */
export function buildPatch(clip: Clip, draft: ClipDraft): ClipPatch {
  const changed = changedFields(clip, draft);
  const patch: ClipPatch = {};
  if (changed.start) patch.start_seconds = round3(draft.start_seconds);
  if (changed.mode) patch.subtitle_mode = draft.subtitle_mode;
  if (changed.framing) patch.framing = draft.framing;
  if (changed.style) patch.style = draft.style;
  if (changed.cues) {
    patch.cues = [...draft.cues]
      .sort((a, b) => a.start_seconds - b.start_seconds)
      .map((c) => ({
        ...c,
        start_seconds: round3(c.start_seconds),
        end_seconds: round3(c.end_seconds),
      }));
  }
  return patch;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface CueIssue {
  id: string;
  message: string;
}

/** Validates cues in local clip time. Returns a list of human-readable issues. */
export function validateCues(cues: Cue[], clipDuration: number, mode: SubtitleMode): CueIssue[] {
  const issues: CueIssue[] = [];
  for (const cue of cues) {
    if (!Number.isFinite(cue.start_seconds) || !Number.isFinite(cue.end_seconds)) {
      issues.push({ id: cue.id, message: "Tempo inválido." });
      continue;
    }
    if (cue.start_seconds < 0 || cue.end_seconds > clipDuration + 1e-6) {
      issues.push({ id: cue.id, message: `Os tempos devem ficar entre 0 e ${clipDuration}s.` });
    }
    if (cue.end_seconds <= cue.start_seconds) {
      issues.push({ id: cue.id, message: "O fim deve ser maior que o início." });
    }
    const needsOriginal = mode === "original" || mode === "both";
    const needsTranslated = mode === "translated" || mode === "both";
    if (needsOriginal && !(cue.original_text ?? "").trim()) {
      issues.push({ id: cue.id, message: "Texto original vazio." });
    }
    if (needsTranslated && !(cue.translated_text ?? "").trim()) {
      issues.push({ id: cue.id, message: "Tradução vazia." });
    }
  }
  return issues;
}

export function hasMissingTranslations(cues: Cue[]): boolean {
  return cues.length > 0 && cues.some((c) => !(c.translated_text ?? "").trim());
}

export function activeCue(cues: Cue[], localTime: number): Cue | null {
  return cues.find((c) => localTime >= c.start_seconds && localTime < c.end_seconds) ?? null;
}

export function newCueId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC4122 v4 fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Splits "#RRGGBBAA" into a 6-digit color and alpha 0..1. Accepts #RGB / #RRGGBB. */
export function splitColor(value: string): { hex: string; alpha: number } {
  const v = (value || "").trim();
  const m8 = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(v);
  if (m8) return { hex: `#${m8[1]!.toLowerCase()}`, alpha: parseInt(m8[2]!, 16) / 255 };
  const m6 = /^#([0-9a-f]{6})$/i.exec(v);
  if (m6) return { hex: `#${m6[1]!.toLowerCase()}`, alpha: 1 };
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (m3) return { hex: `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toLowerCase(), alpha: 1 };
  return { hex: "#000000", alpha: 0 };
}

/** Always returns 8-digit `#rrggbbaa` as required by backend background_color. */
export function joinColor(hex: string, alpha: number): string {
  const base = splitColor(hex).hex;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${base}${a}`;
}

export const OUTPUT_WIDTH = 1080;
