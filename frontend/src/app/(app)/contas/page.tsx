"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Dialog,
  EmptyState,
  LoadingState,
  Spinner,
  errorMessage,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import type { Account } from "@/lib/types";

const OAUTH_ERRORS: Record<string, string> = {
  access_denied: "A autorização foi negada no Google.",
  invalid_state: "A sessão de autorização expirou ou é inválida. Tente conectar novamente.",
  not_configured: "A integração com o YouTube não está configurada no servidor.",
  no_channel: "Nenhum canal do YouTube foi encontrado para a conta Google autorizada.",
  oauth_failed: "Não foi possível concluir a autorização OAuth com o Google. Tente novamente.",
};

function OAuthResult() {
  const params = useSearchParams();
  const connected = params.get("connected");
  const error = params.get("error");
  if (connected === "1") {
    return <Alert tone="success">Conta do YouTube conectada com sucesso.</Alert>;
  }
  if (error) {
    return (
      <Alert tone="danger" title="Não foi possível conectar a conta">
        {OAUTH_ERRORS[error] ?? `Erro informado: ${error}`}
      </Alert>
    );
  }
  return null;
}

export default function AccountsPage() {
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [toDisconnect, setToDisconnect] = useState<Account | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setAccounts(await api.listAccounts());
    } catch (err) {
      setError(errorMessage(err, "Não foi possível carregar as contas."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    setConnecting(true);
    setConnectError(null);
    try {
      const { authorization_url } = await api.connectYoutube();
      const url = new URL(authorization_url);
      if (url.protocol !== "https:") throw new Error("URL de autorização inválida recebida do servidor.");
      window.location.assign(url.toString());
    } catch (err) {
      setConnectError(errorMessage(err, "Não foi possível iniciar a conexão."));
      setConnecting(false);
    }
  }

  async function disconnect() {
    if (!toDisconnect) return;
    setDisconnecting(true);
    try {
      await api.disconnectAccount(toDisconnect.id);
      toast("Conta desconectada.");
      setToDisconnect(null);
      await load();
    } catch (err) {
      toast(errorMessage(err, "Não foi possível desconectar."), true);
    } finally {
      setDisconnecting(false);
    }
  }

  const youtube = accounts?.filter((a) => a.platform === "youtube") ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Contas</h1>
          <p>Conecte canais para publicar seus cortes. O acesso pode ser revogado a qualquer momento.</p>
        </div>
      </div>
      <div className="stack" style={{ maxWidth: 860 }}>
        <Suspense fallback={null}>
          <OAuthResult />
        </Suspense>

        <section className="card" aria-labelledby="yt-title">
          <div className="card-header">
            <div>
              <h2 id="yt-title">YouTube</h2>
              <p>Envio de Shorts via autorização OAuth oficial do Google.</p>
            </div>
            <button className="btn btn-primary" onClick={() => void connect()} disabled={connecting}>
              {connecting && <Spinner />}
              Conectar canal
            </button>
          </div>
          <div className="stack">
            {connectError && <Alert tone="danger">{connectError}</Alert>}
            {error && (
              <Alert
                tone="danger"
                action={
                  <button className="btn btn-sm" onClick={() => void load()}>
                    Tentar novamente
                  </button>
                }
              >
                {error}
              </Alert>
            )}
            {!accounts && !error ? (
              <LoadingState label="Carregando contas…" />
            ) : accounts && youtube.length === 0 ? (
              <EmptyState title="Nenhum canal conectado">
                Conecte um canal do YouTube para habilitar a publicação.
              </EmptyState>
            ) : (
              <ul className="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {youtube.map((a) => (
                  <li key={a.id} className="list-item">
                    <div className="grow">
                      <span className="title">{a.display_name}</span>
                      <span className="meta">
                        {a.first_publish_confirmed
                          ? "Primeira publicação já autorizada"
                          : "A primeira publicação exigirá confirmação extra"}
                      </span>
                    </div>
                    {a.connected ? (
                      <Badge tone="success">Conectada</Badge>
                    ) : (
                      <Badge tone="warning">Desconectada</Badge>
                    )}
                    {a.connected ? (
                      <button className="btn btn-danger btn-sm" onClick={() => setToDisconnect(a)}>
                        Desconectar
                      </button>
                    ) : (
                      <button className="btn btn-sm" onClick={() => void connect()} disabled={connecting}>
                        Reconectar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <div className="grid-2">
          {["Instagram", "TikTok"].map((name) => (
            <section key={name} className="card" aria-disabled="true" style={{ opacity: 0.7 }}>
              <div className="row-between">
                <h2>{name}</h2>
                <Badge tone="neutral">Indisponível</Badge>
              </div>
              <p className="muted small" style={{ marginTop: 8 }}>
                A publicação no {name} não está disponível nesta fase.
              </p>
            </section>
          ))}
        </div>
      </div>

      <Dialog
        open={!!toDisconnect}
        title="Desconectar canal?"
        description={
          toDisconnect
            ? `O acesso ao canal “${toDisconnect.display_name}” será revogado. Publicações pendentes desta conta podem falhar ou exigir atenção.`
            : undefined
        }
        onClose={() => setToDisconnect(null)}
        busy={disconnecting}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setToDisconnect(null)} disabled={disconnecting}>
              Cancelar
            </button>
            <button className="btn btn-danger" onClick={() => void disconnect()} disabled={disconnecting}>
              {disconnecting && <Spinner />}
              Desconectar e revogar
            </button>
          </>
        }
      />
    </>
  );
}
