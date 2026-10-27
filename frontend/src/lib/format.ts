/** Formats seconds as m:ss or h:mm:ss, optionally with tenths. */
export function formatTime(totalSeconds: number | null | undefined, withTenths = false): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return "—";
  const negative = totalSeconds < 0;
  let value = Math.abs(totalSeconds);
  const tenths = Math.floor((value * 10) % 10);
  value = Math.floor(value);
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  const ss = String(s).padStart(2, "0");
  const base = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  return `${negative ? "-" : ""}${base}${withTenths ? `.${tenths}` : ""}`;
}

/** Parses "m:ss(.d)", "h:mm:ss" or plain seconds. Returns null when invalid. */
export function parseTime(input: string): number | null {
  const trimmed = input.trim().replace(",", ".");
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    if (!/^\d+(\.\d+)?$/.test(part)) return null;
    total = total * 60 + Number(part);
  }
  return Number.isFinite(total) ? total : null;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`;
}

export function formatDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
  }
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Value for <input type="datetime-local"> representing `date` in local time. */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** Converts a datetime-local value (browser local time) to an ISO8601 UTC string. */
export function localInputToUtcIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** Project progress is 0..100 or null (indeterminate). Clamp defensively. */
export function clampPercent(progress: number | null | undefined): number | null {
  if (progress == null || !Number.isFinite(progress)) return null;
  return Math.min(100, Math.max(0, progress));
}

export function parseHashtags(input: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of input.split(/[\s,]+/)) {
    const tag = raw.replace(/^#+/, "").trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);
const UNSUPPORTED_PLATFORM_HOSTS = new Set([
  "instagram.com",
  "www.instagram.com",
  "tiktok.com",
  "www.tiktok.com",
  "vm.tiktok.com",
]);

/**
 * Returns the canonical `https://www.youtube.com/watch?v=ID` URL when `value`
 * is a supported single-video YouTube HTTPS link (`watch?v=ID`, `youtu.be/ID`,
 * `shorts/ID` or `embed/ID`), or `null` otherwise.
 */
export function canonicalizeYouTubeUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!YOUTUBE_HOSTS.has(host)) return null;

  const pieces = url.pathname.split("/").filter(Boolean);
  let videoId: string | null = null;
  if (host === "youtu.be" && pieces.length === 1) {
    videoId = pieces[0]!;
  } else if (host !== "youtu.be" && url.pathname.replace(/\/+$/, "") === "/watch") {
    const values = url.searchParams.getAll("v");
    videoId = values.length === 1 ? values[0]! : null;
  } else if (
    host !== "youtu.be" &&
    pieces.length === 2 &&
    (pieces[0] === "shorts" || pieces[0] === "embed")
  ) {
    videoId = pieces[1]!;
  }
  if (!videoId || !YOUTUBE_VIDEO_ID.test(videoId)) return null;
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Validates the source URL entered in the "Link HTTPS" tab.
 * Returns `null` when valid (either a single-video YouTube HTTPS link or a
 * direct public HTTPS MP4 link), or a user-facing pt-BR error message.
 */
export function validateSourceUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!isHttpsUrl(trimmed)) {
    return "Informe um link HTTPS para um vídeo individual do YouTube ou para um arquivo MP4 público (sem usuário/senha).";
  }
  const url = new URL(trimmed);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (YOUTUBE_HOSTS.has(host)) {
    if (url.port) {
      return "O link do YouTube deve usar HTTPS padrão sem credenciais.";
    }
    if (!canonicalizeYouTubeUrl(trimmed)) {
      return "Informe o link de um único vídeo do YouTube (watch?v=ID, youtu.be/ID, shorts/ID ou embed/ID). Playlists, canais e páginas gerais não são aceitos.";
    }
    return null;
  }
  if (
    host.endsWith(".youtube.com") ||
    host.endsWith(".youtu.be") ||
    host.includes("youtube") ||
    host.includes("youtu.be") ||
    UNSUPPORTED_PLATFORM_HOSTS.has(host) ||
    host.endsWith(".instagram.com") ||
    host.endsWith(".tiktok.com")
  ) {
    return "Apenas links de um único vídeo do YouTube (youtube.com / youtu.be) ou links HTTPS diretos para arquivo MP4 são suportados.";
  }
  return null;
}
