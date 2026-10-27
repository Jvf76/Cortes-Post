"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import { ImportPanel } from "@/components/ImportPanel";
import { Alert, EmptyState, ProgressBar, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, formatTime } from "@/lib/format";
import { PROJECT_ACTIVE, isKnownProjectStatus, projectStage, projectStatus } from "@/lib/status";
import type { Project } from "@/lib/types";
import { usePolledResource } from "@/lib/usePolledResource";

const UNKNOWN_POLL_WINDOW_MS = 30_000;

export default function ProjectsPage() {
  const router = useRouter();
  const mountedAt = useRef(Date.now());
  const fetcher = useCallback((signal: AbortSignal) => api.listProjects(signal), []);
  const shouldPoll = useCallback((data: Project[] | null) => {
    if (!data) return false;
    return data.some(
      (p) =>
        PROJECT_ACTIVE.has(p.status) ||
        (!isKnownProjectStatus(p.status) && Date.now() - mountedAt.current < UNKNOWN_POLL_WINDOW_MS),
    );
  }, []);
  const { data, error, loading, reload } = usePolledResource(fetcher, {
    intervalMs: 4000,
    shouldPoll,
    key: "projects",
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Projetos</h1>
          <p>Acompanhe a importação, a transcrição e as sugestões de cortes.</p>
        </div>
      </div>
      <div className="dashboard-grid">
        <section aria-labelledby="projects-title" className="stack">
          <h2 id="projects-title" className="sr-only">
            Seus projetos
          </h2>
          {error && (
            <Alert
              tone="danger"
              title="Não foi possível carregar os projetos"
              action={
                <button className="btn btn-sm" onClick={() => void reload()}>
                  Tentar novamente
                </button>
              }
            >
              {error}
            </Alert>
          )}
          {loading && !data ? (
            <div className="list" aria-busy="true" aria-label="Carregando projetos">
              {[0, 1, 2].map((i) => (
                <div key={i} className="list-item">
                  <div className="grow">
                    <div className="skeleton" style={{ height: 16, width: "50%" }} />
                    <div className="skeleton" style={{ height: 12, width: "30%" }} />
                  </div>
                </div>
              ))}
            </div>
          ) : data && data.length === 0 ? (
            <EmptyState title="Nenhum projeto ainda">
              Importe seu primeiro vídeo pelo painel “Novo projeto”.
            </EmptyState>
          ) : data ? (
            <ul className="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {data.map((project) => (
                <li key={project.id}>
                  <ProjectRow project={project} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        <aside className="card-sticky-wrap">
          <ImportPanel onCreated={(project) => router.push(`/projetos/${project.id}`)} />
        </aside>
      </div>
    </>
  );
}

function ProjectRow({ project }: { project: Project }) {
  const active = PROJECT_ACTIVE.has(project.status);
  const readyClips = project.clips?.length ?? 0;
  return (
    <Link href={`/projetos/${project.id}`} className="list-item">
      <div className="grow">
        <div className="row-between">
          <span className="title">{project.title}</span>
          <StatusBadge info={projectStatus(project.status)} />
        </div>
        <div className="meta">
          {formatDateTime(project.created_at)} · cortes de {project.duration_seconds}s
          {project.source_duration != null && ` · vídeo de ${formatTime(project.source_duration)}`}
          {readyClips > 0 && ` · ${readyClips} ${readyClips === 1 ? "corte" : "cortes"}`}
        </div>
        {active && (
          <div className="stack-sm" style={{ marginTop: 4 }}>
            <div className="row-between small muted">
              <span>{projectStage(project.stage)}</span>
              <span>{project.progress != null ? `${Math.round(project.progress)}%` : "Progresso não informado"}</span>
            </div>
            <ProgressBar value={project.progress} label={`Progresso de ${project.title}`} />
          </div>
        )}
        {project.status === "failed" && project.error && (
          <div className="small" style={{ color: "var(--danger)" }}>
            {project.error}
          </div>
        )}
        {project.status === "ready" && project.error && (
          <div className="small" style={{ color: "var(--warning)" }}>
            Modo manual disponível — {project.error}
          </div>
        )}
      </div>
    </Link>
  );
}
