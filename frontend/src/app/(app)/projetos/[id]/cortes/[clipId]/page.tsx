"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipPlayer, type ClipPlayerHandle } from "@/components/ClipPlayer";
import {
  CueEditor,
  FramingPanel,
  StylePanel,
  SubtitleModePicker,
  TimeInput,
} from "@/components/ClipEditorPanels";
import { PublishDialog } from "@/components/PublishDialog";
import {
  Alert,
  Dialog,
  LoadingState,
  ProgressBar,
  Spinner,
  StatusBadge,
  errorMessage,
  useToast,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import {
  buildPatch,
  changedFields,
  draftFromClip,
  hasMissingTranslations,
  isDirty,
  validateCues,
  type ClipDraft,
} from "@/lib/clipDraft";
import { formatDateTime, formatTime } from "@/lib/format";
import { CLIP_ACTIVE, clipStatus, publicationStatus } from "@/lib/status";
import type { Clip, Project, Publication } from "@/lib/types";
import { usePolledResource } from "@/lib/usePolledResource";

type Tab = "cues" | "style" | "framing";

export default function ClipEditorPage() {
  const params = useParams<{ id: string; clipId: string }>();
  const { id: projectId, clipId } = params;
  const toast = useToast();

  const fetcher = useCallback((signal: AbortSignal) => api.getClip(clipId, signal), [clipId]);
  const shouldPoll = useCallback((c: Clip | null) => !!c && CLIP_ACTIVE.has(c.status), []);
  const { data: clip, error, loading, reload, setData } = usePolledResource(fetcher, {
    intervalMs: 3000,
    shouldPoll,
    key: clipId,
  });

  const [project, setProject] = useState<Project | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  useEffect(() => {
    api
      .getProject(projectId)
      .then(setProject)
      .catch((err) => setProjectError(errorMessage(err)));
  }, [projectId]);

  const [publications, setPublications] = useState<Publication[] | null>(null);
  const loadPublications = useCallback(() => {
    api
      .listPublications()
      .then((list) => setPublications(list.filter((p) => p.clip_id === clipId)))
      .catch(() => setPublications(null));
  }, [clipId]);
  useEffect(() => loadPublications(), [loadPublications]);

  // Draft is derived from a base clip; server updates only replace it when clean.
  const [base, setBase] = useState<Clip | null>(null);
  const [draft, setDraft] = useState<ClipDraft | null>(null);
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    if (!clip) return;
    if (!base || !draft || !isDirty(base, draft)) {
      setBase(clip);
      setDraft(draftFromClip(clip));
      setConflict(false);
    } else if (clip.revision !== base.revision) {
      setConflict(true);
    }
    // Intentionally keyed on server data only; base/draft are read as current values.
  }, [clip]);

  const [tab, setTab] = useState<Tab>("cues");
  const [localTime, setLocalTime] = useState(0);
  const playerRef = useRef<ClipPlayerHandle>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveChecked, setApproveChecked] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const duration = useMemo(() => {
    if (project) return project.duration_seconds;
    if (clip) return Math.round(clip.end_seconds - clip.start_seconds);
    return 30;
  }, [project, clip]);

  if (loading && !clip) return <LoadingState label="Carregando corte…" />;
  if (!clip || !draft || !base) {
    return (
      <div className="stack" style={{ maxWidth: 560 }}>
        <Alert
          tone="danger"
          title="Não foi possível carregar o corte"
          action={
            <button className="btn btn-sm" onClick={() => void reload()}>
              Tentar novamente
            </button>
          }
        >
          {error}
        </Alert>
        <Link href={`/projetos/${projectId}`} className="btn" style={{ alignSelf: "flex-start" }}>
          Voltar ao projeto
        </Link>
      </div>
    );
  }

  const changed = changedFields(base, draft);
  const dirty = Object.values(changed).some(Boolean);
  const issues = validateCues(draft.cues, duration, draft.subtitle_mode);
  const missingTranslations = hasMissingTranslations(draft.cues);
  const maxStart =
    project?.source_duration != null ? Math.max(0, project.source_duration - duration) : null;
  const rendering = CLIP_ACTIVE.has(clip.status);
  const rendered = clip.status === "ready";
  const canApprove = !dirty && !rendering && !rendered && !conflict && issues.length === 0;
  const update = (patch: Partial<ClipDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  async function save() {
    if (!base || !draft) return;
    setSaveError(null);
    if ((changed.cues || changed.mode) && issues.length) {
      setSaveError("Corrija as legendas destacadas (ou preencha a tradução pt-BR) antes de salvar.");
      setTab("cues");
      return;
    }
    if (draft.start_seconds < 0 || (maxStart != null && draft.start_seconds > maxStart + 1e-6)) {
      setSaveError(`O início deve ficar entre 0:00 e ${formatTime(maxStart)}.`);
      return;
    }
    setSaving(true);
    try {
      const updated = await api.patchClip(base.id, buildPatch(base, draft));
      setBase(updated);
      setDraft(draftFromClip(updated));
      setConflict(false);
      setData(updated);
      toast(`Revisão ${updated.revision} salva.`);
    } catch (err) {
      setSaveError(
        err instanceof ApiError && err.status === 409
          ? "O corte foi alterado em outra sessão. Descarte suas alterações para carregar a versão atual."
          : errorMessage(err, "Não foi possível salvar."),
      );
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    if (!clip) return;
    setBase(clip);
    setDraft(draftFromClip(clip));
    setConflict(false);
    setSaveError(null);
  }

  async function approve() {
    if (!clip) return;
    setApproving(true);
    setApproveError(null);
    try {
      const updated = await api.approveClip(clip.id, clip.revision);
      setData(updated);
      setApproveOpen(false);
      toast(`Revisão ${updated.revision} aprovada. Renderização enfileirada.`);
    } catch (err) {
      setApproveError(
        err instanceof ApiError && err.status === 409
          ? "A revisão mudou desde que você abriu esta tela. Atualize e revise novamente."
          : errorMessage(err, "Não foi possível aprovar."),
      );
    } finally {
      setApproving(false);
    }
  }

  const startLocked = changed.cues;
  const cuesLocked = changed.start;

  return (
    <>
      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <nav className="breadcrumb" aria-label="Trilha">
            <Link href="/projetos">Projetos</Link>
            <span aria-hidden>/</span>
            <Link href={`/projetos/${projectId}`}>{project?.title ?? "Projeto"}</Link>
            <span aria-hidden>/</span>
            <span aria-current="page">Corte</span>
          </nav>
          <div className="row">
            <h1>Revisar corte</h1>
            <StatusBadge info={clipStatus(clip.status)} />
            <span className="badge badge-neutral badge-plain">Revisão {clip.revision}</span>
          </div>
          <p className="mono small">
            {formatTime(clip.start_seconds, true)} – {formatTime(clip.end_seconds, true)} · {duration}s
            {Number.isFinite(clip.score) && ` · pontuação ${clip.score.toFixed(2)}`}
          </p>
        </div>
        <div className="row">
          {dirty && (
            <button className="btn btn-ghost" onClick={discard} disabled={saving}>
              Descartar
            </button>
          )}
          <button className="btn" onClick={() => void save()} disabled={!dirty || saving || rendering}>
            {saving && <Spinner />}
            Salvar revisão
          </button>
          <button
            className="btn btn-primary"
            disabled={!canApprove}
            onClick={() => {
              setApproveChecked(false);
              setApproveError(null);
              setApproveOpen(true);
            }}
            title={dirty ? "Salve as alterações antes de aprovar" : undefined}
          >
            Aprovar e renderizar
          </button>
        </div>
      </div>

      <div className="stack" style={{ marginBottom: 20 }}>
        {projectError && <Alert tone="warning">Dados do projeto indisponíveis: {projectError}</Alert>}
        {error && <Alert tone="warning">Falha ao atualizar o corte ({error}).</Alert>}
        {saveError && <Alert tone="danger">{saveError}</Alert>}
        {conflict && (
          <Alert
            tone="warning"
            title="Nova revisão no servidor"
            action={
              <button className="btn btn-sm" onClick={discard}>
                Carregar versão atual
              </button>
            }
          >
            Este corte foi alterado em outra sessão (revisão {clip.revision}). Suas alterações locais
            não foram salvas.
          </Alert>
        )}
        {dirty && (clip.status !== "draft" || rendered) && (
          <Alert tone="info">
            Salvar criará a revisão {clip.revision + 1} e invalidará a aprovação/renderização atual.
          </Alert>
        )}
        {missingTranslations && (
          <Alert tone="info" title="Tradução automática pt-BR indisponível">
            A tradução automática não foi gerada para uma ou mais legendas (integração externa de IA não
            configurada ou indisponível). Você pode usar o modo “Original” ou preencher a tradução pt-BR
            manualmente nas legendas.
          </Alert>
        )}
        {!dirty && issues.length > 0 && (
          <Alert tone="warning" title="Legendas pendentes para o modo selecionado">
            Há {issues.length} {issues.length === 1 ? "pendência" : "pendências"} nas legendas para o modo
            atual. Preencha os campos obrigatórios ou altere para “Original” e salve a revisão antes de
            aprovar.
          </Alert>
        )}
        {clip.reason && (
          <Alert tone="info" title="Por que este trecho foi sugerido">
            {clip.reason}
          </Alert>
        )}
      </div>

      <div className="editor-grid">
        <div className="stack">
          <section className="card" aria-labelledby="preview-title">
            <div className="card-header">
              <h2 id="preview-title">Pré-visualização</h2>
              <span className="hint">Simulação; o render final é a referência.</span>
            </div>
            <ClipPlayer
              handleRef={playerRef}
              sourceUrl={api.projectSourceUrl(projectId)}
              start={draft.start_seconds}
              duration={duration}
              framing={draft.framing}
              style={draft.style}
              mode={draft.subtitle_mode}
              cues={draft.cues}
              onLocalTime={setLocalTime}
            />
          </section>

          <section className="card" aria-labelledby="interval-title">
            <h2 id="interval-title" style={{ marginBottom: 12 }}>
              Intervalo no vídeo original
            </h2>
            <div className="stack-sm">
              <label htmlFor="clip-start" className="label">
                Início
              </label>
              <div className="row">
                <div style={{ width: 120 }}>
                  <TimeInput
                    id="clip-start"
                    label="Início do corte no vídeo original"
                    value={draft.start_seconds}
                    disabled={startLocked || rendering}
                    onCommit={(v) => update({ start_seconds: v })}
                  />
                </div>
                {[-1, -0.1, 0.1, 1].map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    className="btn btn-sm"
                    disabled={startLocked || rendering}
                    onClick={() =>
                      update({
                        start_seconds: Math.max(
                          0,
                          Math.min(maxStart ?? Infinity, Math.round((draft.start_seconds + delta) * 10) / 10),
                        ),
                      })
                    }
                    aria-label={`${delta > 0 ? "Avançar" : "Recuar"} ${Math.abs(delta)} segundo`}
                  >
                    {delta > 0 ? "+" : "−"}
                    {Math.abs(delta)}s
                  </button>
                ))}
              </div>
              <span className="hint">
                Fim: {formatTime(draft.start_seconds + duration, true)} (duração fixa de {duration}s)
                {maxStart != null && ` · início máximo ${formatTime(maxStart)}`}
              </span>
              {startLocked && (
                <span className="hint">Salve as edições de legenda antes de mudar o intervalo.</span>
              )}
              {changed.start && (
                <span className="hint">
                  Ao salvar, o servidor realinha as legendas ao novo intervalo.
                </span>
              )}
            </div>
          </section>

          <RenderPanel
            clip={clip}
            dirty={dirty}
            onPublish={() => setPublishOpen(true)}
          />

          <PublicationsPanel publications={publications} />
        </div>

        <section className="card" aria-labelledby="edit-title">
          <h2 id="edit-title" className="sr-only">
            Edição
          </h2>
          <SubtitleModePicker value={draft.subtitle_mode} onChange={(v) => update({ subtitle_mode: v })} />
          <div className="tabs" role="tablist" aria-label="Seções de edição" style={{ marginTop: 16 }}>
            {(
              [
                ["cues", "Legendas"],
                ["style", "Estilo"],
                ["framing", "Enquadramento"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                aria-controls={`panel-${value}`}
                id={`tab-${value}`}
                onClick={() => setTab(value)}
              >
                {label}
                {value === "cues" && changed.cues ? " •" : ""}
                {value === "style" && changed.style ? " •" : ""}
                {value === "framing" && changed.framing ? " •" : ""}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "cues" && (
              <>
                {cuesLocked && (
                  <div style={{ marginBottom: 12 }}>
                    <Alert tone="info">Salve a alteração do intervalo antes de editar as legendas.</Alert>
                  </div>
                )}
                <CueEditor
                  cues={draft.cues}
                  onChange={(cues) => update({ cues })}
                  duration={duration}
                  localTime={localTime}
                  onSeek={(t) => playerRef.current?.seek(t)}
                  disabled={cuesLocked || rendering}
                  issues={issues}
                />
              </>
            )}
            {tab === "style" && (
              <StylePanel value={draft.style} onChange={(style) => update({ style })} />
            )}
            {tab === "framing" && (
              <FramingPanel value={draft.framing} onChange={(framing) => update({ framing })} />
            )}
          </div>
          <hr className="divider" style={{ margin: "20px 0 14px" }} />
          <label className="checkbox" aria-disabled="true" style={{ opacity: 0.6, cursor: "not-allowed" }}>
            <input type="checkbox" disabled checked={false} readOnly />
            <span>
              Narração por voz sintética <span className="faint">(indisponível nesta fase; o áudio original é mantido)</span>
            </span>
          </label>
        </section>
      </div>

      <Dialog
        open={approveOpen}
        title={`Aprovar revisão ${clip.revision}?`}
        description="A renderização usa exatamente esta revisão. Qualquer edição posterior cria uma nova revisão e exige nova aprovação."
        onClose={() => setApproveOpen(false)}
        busy={approving}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setApproveOpen(false)} disabled={approving}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={() => void approve()} disabled={!approveChecked || approving}>
              {approving && <Spinner />}
              Aprovar e renderizar
            </button>
          </>
        }
      >
        {approveError && <Alert tone="danger">{approveError}</Alert>}
        <dl className="kv">
          <dt>Intervalo</dt>
          <dd className="mono">
            {formatTime(clip.start_seconds, true)} – {formatTime(clip.end_seconds, true)}
          </dd>
          <dt>Legendas</dt>
          <dd>
            {clip.cues.length} ·{" "}
            {clip.subtitle_mode === "both" ? "original + pt-BR" : clip.subtitle_mode === "translated" ? "pt-BR" : "original"}
          </dd>
          <dt>Enquadramento</dt>
          <dd>
            {clip.framing.mode === "crop" ? `Recortar (${Math.round(clip.framing.offset_x * 100)}%)` : "Conter"}
          </dd>
          <dt>Saída</dt>
          <dd>MP4 1080×1920, 30 fps, legendas gravadas, áudio original</dd>
        </dl>
        <label className="checkbox">
          <input type="checkbox" checked={approveChecked} onChange={(e) => setApproveChecked(e.target.checked)} />
          <span>Revisei o texto, as legendas, o estilo e o enquadramento desta revisão.</span>
        </label>
      </Dialog>

      {rendered && (
        <PublishDialog
          open={publishOpen}
          clip={clip}
          defaultTitle={project?.title ?? ""}
          onClose={() => setPublishOpen(false)}
          onPublished={(p) => {
            setPublishOpen(false);
            toast(p.scheduled_at ? "Publicação agendada." : "Publicação enfileirada.");
            loadPublications();
          }}
        />
      )}
    </>
  );
}

function RenderPanel({
  clip,
  dirty,
  onPublish,
}: {
  clip: Clip;
  dirty: boolean;
  onPublish: () => void;
}) {
  const rendering = CLIP_ACTIVE.has(clip.status);
  return (
    <section className="card" aria-labelledby="render-title">
      <div className="card-header">
        <h2 id="render-title">Vídeo final</h2>
        <StatusBadge info={clipStatus(clip.status)} />
      </div>
      {rendering && (
        <div className="stack-sm" aria-live="polite">
          <span className="small muted">
            {clip.status === "queued" ? "Aguardando na fila de renderização…" : "Renderizando…"} (revisão{" "}
            {clip.revision})
          </span>
          <ProgressBar value={null} label="Renderização em andamento" />
        </div>
      )}
      {clip.status === "failed" && (
        <Alert tone="danger" title="A renderização falhou">
          {clip.error ?? "O servidor não informou o motivo."} Revise e aprove novamente.
        </Alert>
      )}
      {clip.status === "draft" && (
        <p className="muted small">
          Aprove a revisão atual para gerar o MP4 vertical com legendas gravadas.
        </p>
      )}
      {clip.status === "ready" && (
        <div className="stack">
          {clip.artifact_url ? (
            <video
              src={clip.artifact_url}
              controls
              playsInline
              preload="metadata"
              style={{ width: "100%", maxHeight: 520, background: "#000", borderRadius: 8, aspectRatio: "9 / 16" }}
            >
              Seu navegador não suporta a reprodução de vídeo.
            </video>
          ) : (
            <Alert tone="warning">O arquivo final ainda não está disponível para pré-visualização.</Alert>
          )}
          <div className="row">
            <a className="btn" href={api.clipDownloadUrl(clip.id)} download>
              Baixar MP4
            </a>
            <a className="btn" href={api.clipSubtitlesUrl(clip.id)} download>
              Baixar SRT
            </a>
            <span className="spacer" />
            <button
              className="btn btn-primary"
              onClick={onPublish}
              disabled={dirty}
              title={dirty ? "Salve ou descarte as alterações antes de publicar" : undefined}
            >
              Publicar…
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function PublicationsPanel({ publications }: { publications: Publication[] | null }) {
  if (!publications || publications.length === 0) return null;
  return (
    <section className="card" aria-labelledby="clip-pubs-title">
      <div className="card-header">
        <h2 id="clip-pubs-title">Publicações deste corte</h2>
        <Link href="/publicacoes" className="small">
          Ver todas
        </Link>
      </div>
      <ul className="stack-sm" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {publications.map((p) => (
          <li key={p.id} className="row-between small">
            <span style={{ overflowWrap: "anywhere" }}>
              {p.title}
              <span className="faint">
                {" "}
                · {p.scheduled_at ? formatDateTime(p.scheduled_at, p.timezone) : formatDateTime(p.created_at)}
              </span>
            </span>
            <StatusBadge info={publicationStatus(p.status)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
