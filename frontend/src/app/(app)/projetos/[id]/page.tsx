"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Dialog,
  EmptyState,
  LoadingState,
  ProgressBar,
  Spinner,
  StatusBadge,
  errorMessage,
  useToast,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { formatDateTime, formatTime, parseTime } from "@/lib/format";
import {
  CLIP_ACTIVE,
  PROJECT_ACTIVE,
  clipStatus,
  isKnownProjectStatus,
  projectStage,
  projectStatus,
} from "@/lib/status";
import type { Clip, Project } from "@/lib/types";
import { usePolledResource } from "@/lib/usePolledResource";

const UNKNOWN_POLL_WINDOW_MS = 30_000;

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const toast = useToast();
  const mountedAt = useRef(Date.now());

  const fetcher = useCallback((signal: AbortSignal) => api.getProject(id, signal), [id]);
  const shouldPoll = useCallback((p: Project | null) => {
    if (!p) return false;
    if (PROJECT_ACTIVE.has(p.status)) return true;
    if (p.clips?.some((c) => CLIP_ACTIVE.has(c.status))) return true;
    return !isKnownProjectStatus(p.status) && Date.now() - mountedAt.current < UNKNOWN_POLL_WINDOW_MS;
  }, []);
  const { data: project, error, loading, reload, setData } = usePolledResource(fetcher, {
    intervalMs: 3000,
    shouldPoll,
    key: id,
  });

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<null | "delete" | "retry" | "lang">(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingLang, setEditingLang] = useState(false);
  const [langInput, setLangInput] = useState("");

  if (loading && !project) return <LoadingState label="Carregando projeto…" />;
  if (!project) {
    const notFound = error && /não encontrado/i.test(error);
    return (
      <div className="stack" style={{ maxWidth: 560 }}>
        <Alert
          tone="danger"
          title={notFound ? "Projeto não encontrado" : "Não foi possível carregar o projeto"}
          action={
            !notFound && (
              <button className="btn btn-sm" onClick={() => void reload()}>
                Tentar novamente
              </button>
            )
          }
        >
          {error}
        </Alert>
        <Link href="/projetos" className="btn" style={{ alignSelf: "flex-start" }}>
          Voltar para projetos
        </Link>
      </div>
    );
  }

  const active = PROJECT_ACTIVE.has(project.status);
  const clips = [...(project.clips ?? [])].sort((a, b) => a.start_seconds - b.start_seconds);

  async function retry() {
    setBusy("retry");
    setActionError(null);
    try {
      setData(await api.retryProject(id));
      toast("Processamento reiniciado.");
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setActionError(null);
    try {
      await api.deleteProject(id);
      toast("Projeto excluído.");
      router.replace("/projetos");
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  async function saveLanguage() {
    const trimmed = langInput.trim();
    if (!/^[A-Za-z]{2,3}(?:-[A-Za-z]{2})?$/.test(trimmed)) {
      setActionError("Informe um código de idioma válido (ex.: pt, pt-BR, en, es).");
      return;
    }
    setBusy("lang");
    setActionError(null);
    try {
      setData(await api.patchProjectLanguage(id, trimmed));
      setEditingLang(false);
      toast("Idioma atualizado.");
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <nav className="breadcrumb" aria-label="Trilha">
            <Link href="/projetos">Projetos</Link>
            <span aria-hidden>/</span>
            <span aria-current="page">{project.title}</span>
          </nav>
          <div className="row">
            <h1 style={{ overflowWrap: "anywhere" }}>{project.title}</h1>
            <StatusBadge info={projectStatus(project.status)} />
          </div>
          <p>
            Criado em {formatDateTime(project.created_at)} · cortes de {project.duration_seconds}s
          </p>
        </div>
        <div className="row">
          {project.status === "failed" && (
            <button className="btn" onClick={() => void retry()} disabled={busy !== null}>
              {busy === "retry" && <Spinner />}
              Tentar novamente
            </button>
          )}
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)} disabled={busy !== null}>
            Excluir projeto
          </button>
        </div>
      </div>

      <div className="stack">
        {actionError && <Alert tone="danger">{actionError}</Alert>}
        {error && (
          <Alert tone="warning">
            Falha ao atualizar o status ({error}). Exibindo os últimos dados recebidos.
          </Alert>
        )}

        {active && (
          <section className="card" aria-labelledby="progress-title">
            <div className="row-between" style={{ marginBottom: 10 }}>
              <h2 id="progress-title">{projectStage(project.stage)}</h2>
              <span className="muted small" aria-live="polite">
                {project.progress != null
                  ? `${Math.round(project.progress)}%`
                  : "Progresso não informado"}
              </span>
            </div>
            <ProgressBar value={project.progress} label="Progresso do processamento" />
            <StageSteps stage={project.stage} />
          </section>
        )}

        {project.status === "failed" && (
          <Alert tone="danger" title="O processamento falhou">
            {project.error ?? "O servidor não informou o motivo."}
          </Alert>
        )}

        {project.status === "ready" && project.error && (
          <Alert
            tone="warning"
            title={
              /gemini|sugestões automáticas|corte manual/i.test(project.error)
                ? "Modo manual ativo (IA opcional não configurada)"
                : "Aviso do processamento"
            }
            action={
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  document.getElementById("manual-start")?.focus();
                  document
                    .getElementById("manual-clip-section")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                Selecionar trecho manual
              </button>
            }
          >
            <div className="stack-sm">
              <span>{project.error}</span>
              <span className="small">
                O vídeo e a transcrição estão prontos. Use a seção{" "}
                <strong>Selecionar trecho manualmente</strong> abaixo para criar o corte com as
                legendas sincronizadas, revisar, aprovar e renderizar o MP4 final.
              </span>
            </div>
          </Alert>
        )}

        <section className="card">
          <dl className="kv">
            <dt>Duração do vídeo</dt>
            <dd>{formatTime(project.source_duration)}</dd>
            <dt>Idioma detectado</dt>
            <dd>
              {editingLang ? (
                <span className="row" style={{ gap: 8 }}>
                  <input
                    aria-label="Código do idioma"
                    className="input input-sm mono"
                    style={{ maxWidth: 110 }}
                    placeholder="pt-BR"
                    value={langInput}
                    onChange={(e) => setLangInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={busy !== null}
                    onClick={() => void saveLanguage()}
                  >
                    Salvar
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={busy !== null}
                    onClick={() => setEditingLang(false)}
                  >
                    Cancelar
                  </button>
                </span>
              ) : (
                <span className="row" style={{ gap: 8 }}>
                  <span>{project.language ?? "—"}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setLangInput(project.language ?? "pt");
                      setEditingLang(true);
                    }}
                  >
                    Corrigir idioma
                  </button>
                </span>
              )}
            </dd>
            <dt>Etapa</dt>
            <dd>{projectStage(project.stage)}</dd>
            <dt>Instruções para os cortes</dt>
            <dd>
              {project.editing_instructions?.trim() ? (
                <div className="stack-sm">
                  <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    {project.editing_instructions}
                  </div>
                  <div className="small muted">
                    Orientações em linguagem natural (não são comandos executados): guiam as
                    sugestões da IA quando configurada; a seleção manual de trechos permanece
                    disponível.
                  </div>
                </div>
              ) : (
                <span className="muted">Nenhuma instrução informada</span>
              )}
            </dd>
          </dl>
        </section>

        <section aria-labelledby="clips-title" className="stack">
          <div className="row-between">
            <div>
              <h2 id="clips-title">Cortes</h2>
              <p className="muted small">
                Revise cada sugestão antes de aprovar a renderização. Limite padrão de 3 cortes
                renderizados por projeto.
              </p>
            </div>
          </div>
          {clips.length === 0 ? (
            active ? (
              <EmptyState title="Gerando sugestões">
                As sugestões aparecerão aqui quando a transcrição e a análise terminarem.
              </EmptyState>
            ) : (
              <EmptyState
                title={
                  project.status === "ready"
                    ? "Pronto para seleção manual de cortes"
                    : "Nenhum corte sugerido"
                }
              >
                {project.status === "ready"
                  ? "A transcrição do vídeo está concluída. Escolha o tempo inicial em “Selecionar trecho manualmente” abaixo para criar um corte com legendas sincronizadas, editar, aprovar e renderizar."
                  : "Os cortes ficam disponíveis após o processamento."}
              </EmptyState>
            )
          ) : (
            <div className="clips-grid">
              {clips.map((clip, index) => (
                <ClipCard key={clip.id} clip={clip} index={index} projectId={project.id} />
              ))}
            </div>
          )}
        </section>

        {project.status === "ready" && (
          <ManualClip project={project} onCreated={(clip) => router.push(`/projetos/${project.id}/cortes/${clip.id}`)} />
        )}
      </div>

      <Dialog
        open={confirmDelete}
        title="Excluir projeto?"
        description="O vídeo, as transcrições, os cortes e os arquivos renderizados deste projeto serão removidos. Tarefas pendentes serão invalidadas. Esta ação não pode ser desfeita."
        onClose={() => setConfirmDelete(false)}
        busy={busy === "delete"}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)} disabled={busy === "delete"}>
              Cancelar
            </button>
            <button className="btn btn-danger" onClick={() => void remove()} disabled={busy === "delete"}>
              {busy === "delete" && <Spinner />}
              Excluir definitivamente
            </button>
          </>
        }
      />
    </>
  );
}

const STAGES = ["importing", "transcribing", "suggesting", "ready"] as const;

function StageSteps({ stage }: { stage: string }) {
  const current = STAGES.indexOf(stage as (typeof STAGES)[number]);
  if (current < 0) return null;
  return (
    <ol className="row small" style={{ listStyle: "none", padding: 0, margin: "14px 0 0", gap: 18 }}>
      {STAGES.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? "step" : undefined}
          style={{ color: i < current ? "var(--accent)" : i === current ? "var(--text)" : "var(--text-faint)" }}
        >
          {i < current ? "✓ " : `${i + 1}. `}
          {projectStage(s)}
        </li>
      ))}
    </ol>
  );
}

function ClipCard({ clip, index, projectId }: { clip: Clip; index: number; projectId: string }) {
  return (
    <Link href={`/projetos/${projectId}/cortes/${clip.id}`} className="clip-card">
      <div className="row-between">
        <strong>Corte {index + 1}</strong>
        <StatusBadge info={clipStatus(clip.status)} />
      </div>
      <div className="mono small">
        {formatTime(clip.start_seconds)} – {formatTime(clip.end_seconds)}
        <span className="faint"> · {Math.round(clip.end_seconds - clip.start_seconds)}s</span>
      </div>
      {clip.reason && (
        <p className="small muted" style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {clip.reason}
        </p>
      )}
      <div className="row-between small">
        <span className="score">Pontuação {Number.isFinite(clip.score) ? clip.score.toFixed(2) : "—"}</span>
        <span className="faint">Revisão {clip.revision}</span>
      </div>
      {CLIP_ACTIVE.has(clip.status) && <ProgressBar value={null} label="Renderização em andamento" />}
      {clip.error && <span className="small" style={{ color: "var(--danger)" }}>{clip.error}</span>}
    </Link>
  );
}

function ManualClip({ project, onCreated }: { project: Project; onCreated: (clip: Clip) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [start, setStart] = useState("0:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoError, setVideoError] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const maxStart =
    project.source_duration != null ? Math.max(0, project.source_duration - project.duration_seconds) : null;

  useEffect(() => {
    setVideoError(false);
  }, [project.id, project.status, project.source_duration]);

  function retryVideo() {
    setVideoError(false);
    setReloadCount((c) => c + 1);
  }

  async function create() {
    setError(null);
    const seconds = parseTime(start);
    if (seconds == null) return setError("Informe o início no formato m:ss ou em segundos.");
    if (maxStart != null && seconds > maxStart + 0.001)
      return setError(`O início máximo é ${formatTime(maxStart)} para cortes de ${project.duration_seconds}s.`);
    setBusy(true);
    try {
      onCreated(await api.createManualClip(project.id, seconds));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="manual-clip-section" className="card" aria-labelledby="manual-title">
      <div className="card-header">
        <div>
          <h2 id="manual-title">Selecionar trecho manualmente</h2>
          <p>
            Escolha o instante inicial para criar um corte de {project.duration_seconds}s com a
            transcrição sincronizada. Na etapa seguinte você poderá revisar as legendas, aprovar e
            renderizar o MP4 compatível.
          </p>
        </div>
      </div>
      <div className="grid-2">
        <div>
          {videoError ? (
            <Alert
              tone="warning"
              title="Pré-visualização do vídeo original indisponível"
              action={
                <button type="button" className="btn btn-sm" onClick={retryVideo}>
                  Tentar recarregar vídeo
                </button>
              }
            >
              Não foi possível carregar ou reproduzir o vídeo original aqui (por exemplo, falha
              temporária ou formato não compatível com o navegador). Você ainda pode informar o
              tempo de início ao lado e clicar em “Criar corte” — o servidor gera um MP4 compatível
              na renderização final.
            </Alert>
          ) : (
            <video
              key={`${project.id}:${reloadCount}`}
              ref={videoRef}
              src={api.projectSourceUrl(project.id)}
              controls
              preload="metadata"
              style={{ width: "100%", borderRadius: 8, background: "#000", maxHeight: 320 }}
              onLoadedMetadata={() => setVideoError(false)}
              onError={() => setVideoError(true)}
            >
              Seu navegador não suporta a reprodução de vídeo.
            </video>
          )}
        </div>
        <div className="stack">
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="field">
            <label htmlFor="manual-start">Início do corte</label>
            <div className="row">
              <input
                id="manual-start"
                className="input mono"
                style={{ maxWidth: 140 }}
                value={start}
                onChange={(e) => setStart(e.target.value)}
                aria-describedby="manual-start-hint"
              />
              <button
                type="button"
                className="btn"
                disabled={videoError}
                onClick={() => {
                  const t = videoRef.current?.currentTime;
                  if (t != null) setStart(formatTime(t, true));
                }}
              >
                Usar posição atual
              </button>
            </div>
            <span id="manual-start-hint" className="hint">
              Formato m:ss ou h:mm:ss{maxStart != null && ` · máximo ${formatTime(maxStart)}`}
            </span>
          </div>
          <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} onClick={() => void create()} disabled={busy}>
            {busy && <Spinner />}
            Criar corte
          </button>
        </div>
      </div>
    </section>
  );
}
