export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

interface StatusInfo {
  label: string;
  tone: Tone;
}

const PROJECT_STATUS: Record<string, StatusInfo> = {
  queued: { label: "Na fila", tone: "info" },
  processing: { label: "Processando", tone: "info" },
  ready: { label: "Pronto", tone: "success" },
  failed: { label: "Falhou", tone: "danger" },
  cancelled: { label: "Cancelado", tone: "neutral" },
};

const PROJECT_STAGE: Record<string, string> = {
  importing: "Importando vídeo",
  transcribing: "Transcrevendo áudio",
  suggesting: "Sugerindo cortes",
  ready: "Concluído",
};

const CLIP_STATUS: Record<string, StatusInfo> = {
  draft: { label: "Rascunho", tone: "neutral" },
  queued: { label: "Na fila de renderização", tone: "info" },
  rendering: { label: "Renderizando", tone: "info" },
  ready: { label: "Renderizado", tone: "success" },
  failed: { label: "Falhou", tone: "danger" },
};

const PUBLICATION_STATUS: Record<string, StatusInfo> = {
  scheduled: { label: "Agendada", tone: "info" },
  queued: { label: "Na fila", tone: "info" },
  uploading: { label: "Enviando", tone: "info" },
  processing: { label: "Processando no YouTube", tone: "info" },
  published: { label: "Publicada", tone: "success" },
  private: { label: "Enviada (privada)", tone: "success" },
  unlisted: { label: "Enviada (não listada)", tone: "success" },
  failed: { label: "Falhou", tone: "danger" },
  needs_attention: { label: "Requer atenção", tone: "warning" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};

/** Unknown values are shown raw (never hidden), with a neutral tone. */
function lookup(map: Record<string, StatusInfo>, value: string): StatusInfo {
  return map[value] ?? { label: value || "—", tone: "neutral" };
}

export const projectStatus = (s: string) => lookup(PROJECT_STATUS, s);
export const clipStatus = (s: string) => lookup(CLIP_STATUS, s);
export const publicationStatus = (s: string) => lookup(PUBLICATION_STATUS, s);
export const projectStage = (s: string) => PROJECT_STAGE[s] ?? s ?? "—";

export const PROJECT_ACTIVE = new Set(["queued", "processing"]);
export const CLIP_ACTIVE = new Set(["queued", "rendering"]);
export const PUBLICATION_ACTIVE = new Set(["queued", "uploading", "processing"]);
export const PUBLICATION_CANCELLABLE = new Set(["scheduled", "queued"]);
export const PUBLICATION_RESCHEDULABLE = new Set(["scheduled"]);

const KNOWN_PROJECT = new Set(Object.keys(PROJECT_STATUS));
const KNOWN_CLIP = new Set(Object.keys(CLIP_STATUS));
const KNOWN_PUBLICATION = new Set(Object.keys(PUBLICATION_STATUS));

export const isKnownProjectStatus = (s: string) => KNOWN_PROJECT.has(s);
export const isKnownClipStatus = (s: string) => KNOWN_CLIP.has(s);
export const isKnownPublicationStatus = (s: string) => KNOWN_PUBLICATION.has(s);
