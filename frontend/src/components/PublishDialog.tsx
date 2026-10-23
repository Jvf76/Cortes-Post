"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
  browserTimeZone,
  formatDateTime,
  localInputToUtcIso,
  parseHashtags,
  toLocalInputValue,
} from "@/lib/format";
import type { Account, Clip, Publication, PublicationCreate, Visibility } from "@/lib/types";
import { Alert, Dialog, LoadingState, Spinner, errorMessage } from "./ui";

const VISIBILITY: { value: Visibility; label: string }[] = [
  { value: "private", label: "Privado" },
  { value: "unlisted", label: "Não listado" },
  { value: "public", label: "Público" },
];

const MIN_LEAD_MS = 5 * 60 * 1000;

export interface PublishFormState {
  accountId: string;
  title: string;
  description: string;
  hashtags: string;
  visibility: Visibility;
  madeForKids: boolean | null;
  synthetic: boolean | null;
  when: "now" | "scheduled";
  scheduledLocal: string;
  confirmFirst: boolean;
}

/** Validates the form; returns a pt-BR message or null when valid. */
export function validatePublishForm(
  form: PublishFormState,
  account: Account | undefined,
  now: Date = new Date(),
): string | null {
  if (!account) return "Selecione uma conta do YouTube conectada.";
  if (!account.connected) return "A conta selecionada está desconectada. Reconecte-a em Contas.";
  if (!form.title.trim()) return "Informe o título do vídeo.";
  if (form.title.length > 100) return "O título pode ter no máximo 100 caracteres.";
  if (/[<>]/.test(form.title)) return "O título não pode conter os caracteres < ou >.";
  if (form.description.length > 5000) return "A descrição pode ter no máximo 5000 caracteres.";
  if (form.madeForKids === null) return "Informe se o vídeo é conteúdo para crianças.";
  if (form.synthetic === null) return "Informe se o vídeo contém mídia sintética ou alterada.";
  if (form.when === "scheduled") {
    const iso = localInputToUtcIso(form.scheduledLocal);
    if (!iso) return "Informe data e hora do agendamento.";
    if (new Date(iso).getTime() < now.getTime() + MIN_LEAD_MS)
      return "O agendamento deve ser pelo menos 5 minutos no futuro.";
  }
  if (!account.first_publish_confirmed && !form.confirmFirst)
    return "Confirme a autorização da primeira publicação nesta conta.";
  return null;
}

export function buildPublicationPayload(
  form: PublishFormState,
  clip: Clip,
  timezone: string,
): PublicationCreate {
  return {
    clip_id: clip.id,
    revision: clip.revision,
    account_id: form.accountId,
    title: form.title.trim(),
    description: form.description.trim(),
    hashtags: parseHashtags(form.hashtags),
    visibility: form.visibility,
    made_for_kids: form.madeForKids === true,
    contains_synthetic_media: form.synthetic === true,
    scheduled_at: form.when === "scheduled" ? localInputToUtcIso(form.scheduledLocal) : null,
    timezone,
    confirm_first_publish: form.confirmFirst,
    confirmed: true,
  };
}

function YesNo({
  name,
  legend,
  value,
  onChange,
  hint,
}: {
  name: string;
  legend: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="label" style={{ marginBottom: 6 }}>
        {legend}
      </legend>
      <div className="row">
        <label className="checkbox">
          <input type="radio" name={name} checked={value === true} onChange={() => onChange(true)} />
          Sim
        </label>
        <label className="checkbox">
          <input type="radio" name={name} checked={value === false} onChange={() => onChange(false)} />
          Não
        </label>
      </div>
      {hint && <span className="hint">{hint}</span>}
    </fieldset>
  );
}

export function PublishDialog({
  open,
  clip,
  defaultTitle,
  onClose,
  onPublished,
}: {
  open: boolean;
  clip: Clip;
  defaultTitle: string;
  onClose: () => void;
  onPublished: (p: Publication) => void;
}) {
  const timezone = useMemo(() => browserTimeZone(), []);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "review">("form");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finalConfirm, setFinalConfirm] = useState(false);
  const [form, setForm] = useState<PublishFormState>(() => ({
    accountId: "",
    title: defaultTitle.slice(0, 100),
    description: "",
    hashtags: "#shorts",
    visibility: "private",
    madeForKids: null,
    synthetic: null,
    when: "now",
    scheduledLocal: toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)),
    confirmFirst: false,
  }));

  useEffect(() => {
    if (!open) return;
    setStep("form");
    setError(null);
    setFinalConfirm(false);
    setAccounts(null);
    setLoadError(null);
    api
      .listAccounts()
      .then((list) => {
        const yt = list.filter((a) => a.platform === "youtube" && a.connected);
        setAccounts(yt);
        setForm((f) => ({ ...f, accountId: f.accountId || yt[0]?.id || "" }));
      })
      .catch((err) => setLoadError(errorMessage(err, "Não foi possível carregar as contas.")));
  }, [open]);

  const account = accounts?.find((a) => a.id === form.accountId);
  const set = <K extends keyof PublishFormState>(key: K, value: PublishFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function review() {
    const message = validatePublishForm(form, account);
    setError(message);
    if (!message) {
      setFinalConfirm(false);
      setStep("review");
    }
  }

  async function submit() {
    const message = validatePublishForm(form, account);
    if (message) {
      setError(message);
      setStep("form");
      return;
    }
    if (!finalConfirm) return;
    setBusy(true);
    setError(null);
    try {
      const publication = await api.createPublication(buildPublicationPayload(form, clip, timezone));
      onPublished(publication);
    } catch (err) {
      setError(errorMessage(err, "Não foi possível criar a publicação."));
    } finally {
      setBusy(false);
    }
  }

  const scheduledIso = form.when === "scheduled" ? localInputToUtcIso(form.scheduledLocal) : null;

  let body;
  if (loadError) {
    body = <Alert tone="danger">{loadError}</Alert>;
  } else if (!accounts) {
    body = <LoadingState label="Carregando contas…" />;
  } else if (accounts.length === 0) {
    body = (
      <Alert tone="info" title="Nenhuma conta do YouTube conectada">
        Conecte um canal em <Link href="/contas">Contas</Link> para publicar.
      </Alert>
    );
  } else if (step === "form") {
    body = (
      <>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="field">
          <span className="label">Plataforma</span>
          <div className="segmented" role="radiogroup" aria-label="Plataforma">
            <button type="button" role="radio" aria-checked>
              YouTube Shorts
            </button>
            <button type="button" role="radio" aria-checked={false} disabled title="Indisponível nesta fase">
              Instagram (indisponível)
            </button>
            <button type="button" role="radio" aria-checked={false} disabled title="Indisponível nesta fase">
              TikTok (indisponível)
            </button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="pub-account">Canal</label>
          <select
            id="pub-account"
            className="select"
            value={form.accountId}
            onChange={(e) => set("accountId", e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pub-title">Título</label>
          <input
            id="pub-title"
            className="input"
            value={form.title}
            maxLength={100}
            onChange={(e) => set("title", e.target.value)}
          />
          <span className="hint">{form.title.length}/100</span>
        </div>
        <div className="field">
          <label htmlFor="pub-desc">Descrição</label>
          <textarea
            id="pub-desc"
            className="textarea"
            rows={3}
            maxLength={5000}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="pub-tags">Hashtags</label>
          <input
            id="pub-tags"
            className="input"
            value={form.hashtags}
            onChange={(e) => set("hashtags", e.target.value)}
            aria-describedby="pub-tags-hint"
          />
          <span id="pub-tags-hint" className="hint">
            Separe por espaço ou vírgula.
          </span>
        </div>
        <div className="field">
          <span className="label" id="pub-vis-label">
            Visibilidade
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="pub-vis-label">
            {VISIBILITY.map((v) => (
              <button
                key={v.value}
                type="button"
                role="radio"
                aria-checked={form.visibility === v.value}
                onClick={() => set("visibility", v.value)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <YesNo
          name="kids"
          legend="Conteúdo feito para crianças?"
          value={form.madeForKids}
          onChange={(v) => set("madeForKids", v)}
          hint="Exigido pelo YouTube (COPPA)."
        />
        <YesNo
          name="synthetic"
          legend="Contém mídia sintética ou alterada de forma realista?"
          value={form.synthetic}
          onChange={(v) => set("synthetic", v)}
        />
        <div className="field">
          <span className="label" id="pub-when-label">
            Quando publicar
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="pub-when-label">
            <button type="button" role="radio" aria-checked={form.when === "now"} onClick={() => set("when", "now")}>
              Agora
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={form.when === "scheduled"}
              onClick={() => set("when", "scheduled")}
            >
              Agendar
            </button>
          </div>
        </div>
        {form.when === "scheduled" && (
          <div className="field">
            <label htmlFor="pub-at">Data e hora</label>
            <input
              id="pub-at"
              className="input"
              type="datetime-local"
              value={form.scheduledLocal}
              onChange={(e) => set("scheduledLocal", e.target.value)}
              aria-describedby="pub-at-hint"
            />
            <span id="pub-at-hint" className="hint">
              Fuso horário: {timezone}. O envio começa no horário escolhido.
            </span>
          </div>
        )}
        {account && !account.first_publish_confirmed && (
          <Alert tone="warning" title="Primeira publicação neste canal">
            <label className="checkbox" style={{ marginTop: 6 }}>
              <input
                type="checkbox"
                checked={form.confirmFirst}
                onChange={(e) => set("confirmFirst", e.target.checked)}
              />
              <span>
                Autorizo o Cortes Automáticos a enviar vídeos para o canal “{account.display_name}”.
              </span>
            </label>
          </Alert>
        )}
      </>
    );
  } else {
    body = (
      <>
        {error && <Alert tone="danger">{error}</Alert>}
        <dl className="kv">
          <dt>Canal</dt>
          <dd>{account?.display_name}</dd>
          <dt>Revisão</dt>
          <dd>{clip.revision}</dd>
          <dt>Título</dt>
          <dd style={{ overflowWrap: "anywhere" }}>{form.title}</dd>
          <dt>Visibilidade</dt>
          <dd>{VISIBILITY.find((v) => v.value === form.visibility)?.label}</dd>
          <dt>Hashtags</dt>
          <dd>{parseHashtags(form.hashtags).map((t) => `#${t}`).join(" ") || "—"}</dd>
          <dt>Para crianças</dt>
          <dd>{form.madeForKids ? "Sim" : "Não"}</dd>
          <dt>Mídia sintética</dt>
          <dd>{form.synthetic ? "Sim" : "Não"}</dd>
          <dt>Quando</dt>
          <dd>
            {scheduledIso ? `${formatDateTime(scheduledIso, timezone)} (${timezone})` : "Imediatamente"}
          </dd>
        </dl>
        <label className="checkbox">
          <input type="checkbox" checked={finalConfirm} onChange={(e) => setFinalConfirm(e.target.checked)} />
          <span>
            Confirmo a {scheduledIso ? "publicação agendada" : "publicação"} desta revisão no YouTube
            com os dados acima.
          </span>
        </label>
      </>
    );
  }

  const canInteract = !!accounts && accounts.length > 0 && !loadError;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      wide
      title={step === "form" ? "Publicar no YouTube" : "Confirmar publicação"}
      description={
        step === "form"
          ? `A revisão ${clip.revision} renderizada será enviada. Nada é publicado sem sua confirmação final.`
          : "Revise os dados. Ao confirmar, a publicação será enfileirada."
      }
      footer={
        <>
          {step === "review" ? (
            <button className="btn btn-ghost" onClick={() => setStep("form")} disabled={busy}>
              Voltar
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
          )}
          {canInteract &&
            (step === "form" ? (
              <button className="btn btn-primary" onClick={review}>
                Revisar
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => void submit()} disabled={!finalConfirm || busy}>
                {busy && <Spinner />}
                {scheduledIso ? "Confirmar agendamento" : "Confirmar e publicar"}
              </button>
            ))}
        </>
      }
    >
      {body}
    </Dialog>
  );
}
