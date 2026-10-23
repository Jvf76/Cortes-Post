"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Dialog,
  EmptyState,
  LoadingState,
  Spinner,
  StatusBadge,
  errorMessage,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import {
  browserTimeZone,
  formatDateTime,
  localInputToUtcIso,
  toLocalInputValue,
} from "@/lib/format";
import {
  PUBLICATION_ACTIVE,
  PUBLICATION_CANCELLABLE,
  PUBLICATION_RESCHEDULABLE,
  publicationStatus,
} from "@/lib/status";
import type { Publication } from "@/lib/types";
import { usePolledResource } from "@/lib/usePolledResource";

export default function PublicationsPage() {
  const toast = useToast();
  const fetcher = useCallback((signal: AbortSignal) => api.listPublications(signal), []);
  const shouldPoll = useCallback(
    (list: Publication[] | null) =>
      !!list && list.some((p) => PUBLICATION_ACTIVE.has(p.status) || p.status === "scheduled"),
    [],
  );
  const { data, error, loading, reload } = usePolledResource(fetcher, {
    intervalMs: 5000,
    shouldPoll,
    key: "publications",
  });

  const [toCancel, setToCancel] = useState<Publication | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [toReschedule, setToReschedule] = useState<Publication | null>(null);

  const sorted = useMemo(
    () => [...(data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [data],
  );

  async function cancel() {
    if (!toCancel) return;
    setCancelling(true);
    try {
      await api.cancelPublication(toCancel.id);
      toast("Publicação cancelada.");
      setToCancel(null);
      await reload();
    } catch (err) {
      toast(errorMessage(err, "Não foi possível cancelar."), true);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Publicações</h1>
          <p>Acompanhe envios imediatos e agendados. Horários exibidos no fuso escolhido.</p>
        </div>
      </div>
      <div className="stack">
        {error && (
          <Alert
            tone="danger"
            title="Não foi possível carregar as publicações"
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
          <LoadingState label="Carregando publicações…" />
        ) : data && sorted.length === 0 ? (
          <EmptyState title="Nenhuma publicação">
            Renderize e aprove um corte, depois use “Publicar…” na tela de revisão.
          </EmptyState>
        ) : data ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Título</th>
                  <th scope="col">Status</th>
                  <th scope="col">Agendamento</th>
                  <th scope="col">Criada</th>
                  <th scope="col">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr key={p.id}>
                    <td style={{ maxWidth: 320 }}>
                      <div style={{ overflowWrap: "anywhere", fontWeight: 550 }}>{p.title}</div>
                      <div className="faint small">{p.platform === "youtube" ? "YouTube" : p.platform}</div>
                      {p.error && (
                        <div className="small" style={{ color: p.status === "needs_attention" ? "var(--warning)" : "var(--danger)", marginTop: 4 }}>
                          {p.error}
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge info={publicationStatus(p.status)} />
                    </td>
                    <td className="small">
                      {p.scheduled_at ? (
                        <>
                          <div>{formatDateTime(p.scheduled_at, p.timezone)}</div>
                          <div className="faint">{p.timezone}</div>
                        </>
                      ) : (
                        <span className="faint">Imediata</span>
                      )}
                    </td>
                    <td className="small faint">{formatDateTime(p.created_at)}</td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        {p.remote_url && /^https:\/\//.test(p.remote_url) && (
                          <a className="btn btn-sm" href={p.remote_url} target="_blank" rel="noopener noreferrer">
                            Abrir no YouTube
                          </a>
                        )}
                        {PUBLICATION_RESCHEDULABLE.has(p.status) && (
                          <button className="btn btn-sm" onClick={() => setToReschedule(p)}>
                            Reagendar
                          </button>
                        )}
                        {PUBLICATION_CANCELLABLE.has(p.status) && (
                          <button className="btn btn-sm btn-danger" onClick={() => setToCancel(p)}>
                            Cancelar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <Dialog
        open={!!toCancel}
        title="Cancelar publicação?"
        description={toCancel ? `“${toCancel.title}” não será enviada ao YouTube.` : undefined}
        onClose={() => setToCancel(null)}
        busy={cancelling}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setToCancel(null)} disabled={cancelling}>
              Voltar
            </button>
            <button className="btn btn-danger" onClick={() => void cancel()} disabled={cancelling}>
              {cancelling && <Spinner />}
              Cancelar publicação
            </button>
          </>
        }
      />

      {toReschedule && (
        <RescheduleDialog
          publication={toReschedule}
          onClose={() => setToReschedule(null)}
          onDone={() => {
            setToReschedule(null);
            toast("Agendamento atualizado.");
            void reload();
          }}
        />
      )}
    </>
  );
}

function RescheduleDialog({
  publication,
  onClose,
  onDone,
}: {
  publication: Publication;
  onClose: () => void;
  onDone: () => void;
}) {
  const timezone = useMemo(() => browserTimeZone(), []);
  const [value, setValue] = useState(() =>
    toLocalInputValue(publication.scheduled_at ? new Date(publication.scheduled_at) : new Date(Date.now() + 3600_000)),
  );
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const iso = localInputToUtcIso(value);
    if (!iso) return setError("Informe data e hora válidas.");
    if (new Date(iso).getTime() < Date.now() + 5 * 60_000)
      return setError("O agendamento deve ser pelo menos 5 minutos no futuro.");
    setBusy(true);
    setError(null);
    try {
      await api.reschedulePublication(publication.id, iso, timezone);
      onDone();
    } catch (err) {
      setError(errorMessage(err, "Não foi possível reagendar."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Reagendar publicação"
      description={`“${publication.title}”`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Voltar
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={!confirmed || busy}>
            {busy && <Spinner />}
            Confirmar novo horário
          </button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="field">
        <label htmlFor="resched-at">Nova data e hora</label>
        <input
          id="resched-at"
          type="datetime-local"
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <span className="hint">Fuso horário: {timezone}</span>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>Confirmo o novo horário de publicação.</span>
      </label>
    </Dialog>
  );
}
