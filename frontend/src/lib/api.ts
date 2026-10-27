import type {
  Account,
  AuthResponse,
  Capabilities,
  Clip,
  ClipDuration,
  ClipPatch,
  Project,
  Publication,
  PublicationCreate,
} from "./types";

/** All requests go to the same origin; the Next server proxies `/api/*`. */
export const API_BASE = "/api";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let csrfToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

/** Registered by the auth provider so an expired session sends the user to login. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const NO_REDIRECT_ON_401 = ["/auth/me", "/auth/login", "/auth/register"];

/** Turns `{detail}` (string or FastAPI validation list) into a readable message. */
export function extractDetail(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail)) {
      const parts = detail
        .map((item) => {
          if (item && typeof item === "object" && "msg" in item) {
            const loc = Array.isArray((item as { loc?: unknown }).loc)
              ? ((item as { loc: unknown[] }).loc.filter((p) => p !== "body").join("."))
              : "";
            const msg = String((item as { msg: unknown }).msg);
            return loc ? `${loc}: ${msg}` : msg;
          }
          return typeof item === "string" ? item : "";
        })
        .filter(Boolean);
      if (parts.length) return parts.join("; ");
    }
  }
  return defaultMessage(status);
}

export function defaultMessage(status: number): string {
  if (status === 0) return "Não foi possível conectar ao servidor. Verifique sua conexão.";
  if (status === 401) return "Sua sessão expirou. Entre novamente.";
  if (status === 403) return "Você não tem permissão para esta ação.";
  if (status === 404) return "Recurso não encontrado.";
  if (status === 409) return "Conflito: o recurso foi alterado. Atualize e tente novamente.";
  if (status === 413) return "Arquivo grande demais.";
  if (status === 429) return "Muitas solicitações. Aguarde um momento.";
  if (status === 502 || status === 503 || status === 504)
    return "O servidor está indisponível no momento. Tente novamente em instantes.";
  if (status >= 500) return "Erro interno do servidor.";
  return `Falha na solicitação (HTTP ${status}).`;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (MUTATING.has(method) && csrfToken) headers["X-CSRF-Token"] = csrfToken;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body,
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, defaultMessage(0));
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && !NO_REDIRECT_ON_401.some((p) => path.startsWith(p))) {
      unauthorizedHandler?.();
    }
    throw new ApiError(response.status, extractDetail(payload, response.status));
  }
  return payload as T;
}

export interface UploadInput {
  file: File;
  title: string;
  duration_seconds: ClipDuration;
  rights_confirmed: boolean;
  editing_instructions?: string;
}

export interface UploadHandle {
  promise: Promise<Project>;
  abort: () => void;
}

/**
 * Multipart upload through XMLHttpRequest so the UI can show the genuine byte
 * progress reported by the browser (fetch has no upload progress events).
 */
export function uploadProject(
  input: UploadInput,
  onProgress: (loaded: number, total: number | null) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<Project>((resolve, reject) => {
    const form = new FormData();
    form.append("file", input.file);
    form.append("title", input.title);
    form.append("duration_seconds", String(input.duration_seconds));
    form.append("rights_confirmed", input.rights_confirmed ? "true" : "false");
    form.append("editing_instructions", input.editing_instructions ?? "");

    xhr.open("POST", `${API_BASE}/projects/upload`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    if (csrfToken) xhr.setRequestHeader("X-CSRF-Token", csrfToken);
    xhr.upload.onprogress = (event) => {
      onProgress(event.loaded, event.lengthComputable ? event.total : null);
    };
    xhr.onload = () => {
      let payload: unknown = null;
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        payload = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as Project);
      } else {
        if (xhr.status === 401) unauthorizedHandler?.();
        reject(new ApiError(xhr.status, extractDetail(payload, xhr.status)));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, defaultMessage(0)));
    xhr.onabort = () => reject(new DOMException("Upload cancelado", "AbortError"));
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

const enc = encodeURIComponent;

export const api = {
  me: () => apiRequest<AuthResponse>("/auth/me"),
  login: (email: string, password: string) =>
    apiRequest<AuthResponse>("/auth/login", { method: "POST", body: { email, password } }),
  register: (email: string, password: string) =>
    apiRequest<AuthResponse>("/auth/register", { method: "POST", body: { email, password } }),
  logout: () => apiRequest<void>("/auth/logout", { method: "POST" }),

  listProjects: (signal?: AbortSignal) => apiRequest<Project[]>("/projects", { signal }),
  createProjectFromUrl: (input: {
    title: string;
    source_url: string;
    duration_seconds: ClipDuration;
    rights_confirmed: true;
    editing_instructions?: string;
  }) =>
    apiRequest<Project>("/projects", {
      method: "POST",
      body: {
        ...input,
        editing_instructions: input.editing_instructions ?? "",
      },
    }),
  getProject: (id: string, signal?: AbortSignal) =>
    apiRequest<Project>(`/projects/${enc(id)}`, { signal }),
  deleteProject: (id: string) => apiRequest<void>(`/projects/${enc(id)}`, { method: "DELETE" }),
  retryProject: (id: string) =>
    apiRequest<Project>(`/projects/${enc(id)}/retry`, { method: "POST" }),
  patchProjectLanguage: (id: string, language: string) =>
    apiRequest<Project>(`/projects/${enc(id)}/language`, {
      method: "PATCH",
      body: { language },
    }),
  projectSourceUrl: (id: string) => `${API_BASE}/projects/${enc(id)}/source`,
  createManualClip: (projectId: string, start_seconds: number) =>
    apiRequest<Clip>(`/projects/${enc(projectId)}/clips`, {
      method: "POST",
      body: { start_seconds },
    }),

  getClip: (id: string, signal?: AbortSignal) => apiRequest<Clip>(`/clips/${enc(id)}`, { signal }),
  patchClip: (id: string, patch: ClipPatch) =>
    apiRequest<Clip>(`/clips/${enc(id)}`, { method: "PATCH", body: patch }),
  approveClip: (id: string, revision: number) =>
    apiRequest<Clip>(`/clips/${enc(id)}/approve`, { method: "POST", body: { revision } }),
  clipDownloadUrl: (id: string) => `${API_BASE}/clips/${enc(id)}/download`,
  clipSubtitlesUrl: (id: string) => `${API_BASE}/clips/${enc(id)}/subtitles`,

  listAccounts: () => apiRequest<Account[]>("/accounts"),
  connectYoutube: () =>
    apiRequest<{ authorization_url: string }>("/accounts/youtube/connect"),
  disconnectAccount: (id: string) =>
    apiRequest<void>(`/accounts/${enc(id)}`, { method: "DELETE" }),

  listPublications: (signal?: AbortSignal) =>
    apiRequest<Publication[]>("/publications", { signal }),
  createPublication: (input: PublicationCreate) =>
    apiRequest<Publication>("/publications", { method: "POST", body: input }),
  cancelPublication: (id: string) =>
    apiRequest<Publication>(`/publications/${enc(id)}/cancel`, { method: "POST" }),
  reschedulePublication: (id: string, scheduled_at: string, timezone: string) =>
    apiRequest<Publication>(`/publications/${enc(id)}`, {
      method: "PATCH",
      body: { scheduled_at, timezone, confirmed: true },
    }),

  capabilities: () => apiRequest<Capabilities>("/capabilities"),
};
