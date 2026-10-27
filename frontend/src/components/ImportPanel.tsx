"use client";

import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { api, uploadProject, type UploadHandle } from "@/lib/api";
import { formatBytes, validateSourceUrl } from "@/lib/format";
import { MAX_EDITING_INSTRUCTIONS, type ClipDuration, type Project } from "@/lib/types";
import { Alert, ProgressBar, Spinner, errorMessage } from "./ui";

type Source = "url" | "file";
const DURATIONS: ClipDuration[] = [30, 45, 60];
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export function DurationPicker({
  value,
  onChange,
  disabled,
  label = "Duração de cada corte",
}: {
  value: ClipDuration;
  onChange: (v: ClipDuration) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="field">
      <span className="label" id="duration-label">
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby="duration-label">
        {DURATIONS.map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={value === d}
            disabled={disabled}
            onClick={() => onChange(d)}
          >
            {d} s
          </button>
        ))}
      </div>
    </div>
  );
}

function isMp4(file: File): boolean {
  return file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4");
}

export function ImportPanel({ onCreated }: { onCreated: (project: Project) => void }) {
  const [source, setSource] = useState<Source>("url");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<ClipDuration>(30);
  const [instructions, setInstructions] = useState("");
  const [rights, setRights] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<{ loaded: number; total: number | null } | null>(null);
  const [drag, setDrag] = useState(false);
  const handleRef = useRef<UploadHandle | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function pickFile(f: File | null) {
    setError(null);
    if (f && !isMp4(f)) {
      setError("Apenas arquivos MP4 são aceitos.");
      return;
    }
    setFile(f);
    if (f && !title.trim()) setTitle(f.name.replace(/\.mp4$/i, ""));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    if (busy) return;
    pickFile(e.dataTransfer.files?.[0] ?? null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!title.trim()) return setError("Informe um título para o projeto.");
    const trimmedInstructions = instructions.trim();
    if (trimmedInstructions.length > MAX_EDITING_INSTRUCTIONS) {
      return setError(
        `As instruções para os cortes devem ter no máximo ${MAX_EDITING_INSTRUCTIONS} caracteres.`,
      );
    }
    if (!rights) return setError("Confirme que você tem os direitos sobre o vídeo.");
    setBusy(true);
    try {
      let project: Project;
      if (source === "url") {
        const urlError = validateSourceUrl(url);
        if (urlError) {
          setBusy(false);
          return setError(urlError);
        }
        project = await api.createProjectFromUrl({
          title: title.trim(),
          source_url: url.trim(),
          duration_seconds: duration,
          rights_confirmed: true,
          editing_instructions: trimmedInstructions,
        });
      } else {
        if (!file) {
          setBusy(false);
          return setError("Selecione um arquivo MP4.");
        }
        setUpload({ loaded: 0, total: file.size });
        const handle = uploadProject(
          {
            file,
            title: title.trim(),
            duration_seconds: duration,
            rights_confirmed: true,
            editing_instructions: trimmedInstructions,
          },
          (loaded, total) => setUpload({ loaded, total }),
        );
        handleRef.current = handle;
        project = await handle.promise;
      }
      setTitle("");
      setUrl("");
      setFile(null);
      setInstructions("");
      setRights(false);
      onCreated(project);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Envio cancelado.");
      } else {
        setError(errorMessage(err, "Não foi possível criar o projeto."));
      }
    } finally {
      handleRef.current = null;
      setUpload(null);
      setBusy(false);
    }
  }

  const uploadPct =
    upload && upload.total ? Math.round((upload.loaded / upload.total) * 100) : null;

  return (
    <section className="card" aria-labelledby="import-title">
      <div className="card-header">
        <div>
          <h2 id="import-title">Novo projeto</h2>
          <p>
            Importe um vídeo individual do YouTube ou um MP4 autorizado para gerar até 5 sugestões
            de cortes.
          </p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Origem do vídeo">
        <button
          type="button"
          role="tab"
          aria-selected={source === "url"}
          disabled={busy}
          onClick={() => setSource("url")}
        >
          Link HTTPS
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={source === "file"}
          disabled={busy}
          onClick={() => setSource("file")}
        >
          Arquivo
        </button>
      </div>

      <form className="stack" onSubmit={submit} noValidate aria-busy={busy}>
        {error && <Alert tone="danger">{error}</Alert>}

        <div className="field">
          <label htmlFor="project-title">Título</label>
          <input
            id="project-title"
            className="input"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            required
          />
        </div>

        {source === "url" ? (
          <div className="field">
            <label htmlFor="project-url">Link do YouTube ou MP4 direto (HTTPS)</label>
            <input
              id="project-url"
              className="input"
              type="url"
              inputMode="url"
              placeholder="https://www.youtube.com/watch?v=... ou https://exemplo.com/video.mp4"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
              aria-describedby="project-url-hint"
            />
            <span id="project-url-hint" className="hint">
              Aceita apenas um vídeo individual do YouTube (<code>youtube.com/watch?v=ID</code>,{" "}
              <code>youtu.be/ID</code>, <code>youtube.com/shorts/ID</code> ou{" "}
              <code>youtube.com/embed/ID</code>) ou link HTTPS direto para um arquivo MP4 público
              (sem usuário/senha). Playlists, canais e outras páginas não são suportados. Vídeos
              indisponíveis, privados, restritos ou transmissões ao vivo (lives) podem exigir o
              envio do arquivo MP4 original na aba Arquivo. Nunca solicitamos cookies, senhas ou
              chaves de API.
            </span>
          </div>
        ) : (
          <div className="field">
            <span className="label" id="file-label">
              Arquivo MP4
            </span>
            <div
              className={`dropzone${drag ? " drag" : ""}`}
              role="button"
              tabIndex={busy ? -1 : 0}
              aria-labelledby="file-label"
              aria-describedby="file-hint"
              aria-disabled={busy}
              onClick={() => !busy && fileInput.current?.click()}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !busy) {
                  e.preventDefault();
                  fileInput.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
            >
              {file ? (
                <>
                  <strong>{file.name}</strong>
                  <div className="small">{formatBytes(file.size)} · clique para trocar</div>
                </>
              ) : (
                <>
                  <strong>Arraste um MP4 aqui</strong>
                  <div className="small">ou clique para selecionar</div>
                </>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="video/mp4,.mp4"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            <span id="file-hint" className="hint">
              Limite padrão: 2 GB e 60 minutos (o servidor valida os limites configurados).
            </span>
            {file && file.size > DEFAULT_MAX_BYTES && (
              <Alert tone="warning">
                Este arquivo excede 2 GB e provavelmente será recusado pelo servidor.
              </Alert>
            )}
          </div>
        )}

        <DurationPicker value={duration} onChange={setDuration} disabled={busy} />

        <div className="field">
          <div className="row-between">
            <label htmlFor="project-instructions">Instruções para os cortes (opcional)</label>
            <span className="small muted" aria-live="polite">
              {instructions.length}/{MAX_EDITING_INSTRUCTIONS}
            </span>
          </div>
          <textarea
            id="project-instructions"
            className="textarea"
            rows={3}
            maxLength={MAX_EDITING_INSTRUCTIONS}
            placeholder="Ex.: Priorize momentos sobre precificação, dúvidas da audiência e exemplos práticos; evite a abertura e os avisos finais."
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            disabled={busy}
            aria-describedby="project-instructions-hint"
          />
          <span id="project-instructions-hint" className="hint">
            Exemplo: indique temas, perguntas ou momentos-chave que deseja destacar ou evitar. Estas
            instruções em linguagem natural apenas orientam as sugestões da IA quando configurada
            (não são comandos executados); se a IA não estiver ativa, nenhuma sugestão é simulada e
            a seleção manual do trecho continua disponível.
          </span>
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={rights}
            onChange={(e) => setRights(e.target.checked)}
            disabled={busy}
          />
          <span>
            Confirmo que tenho os direitos ou a autorização necessária para editar e publicar este
            vídeo.
          </span>
        </label>

        {upload && (
          <div className="stack-sm" aria-live="polite">
            <div className="row-between small muted">
              <span>Enviando arquivo…</span>
              <span>
                {formatBytes(upload.loaded)}
                {upload.total ? ` de ${formatBytes(upload.total)}` : ""}
                {uploadPct != null ? ` · ${uploadPct}%` : ""}
              </span>
            </div>
            <ProgressBar value={uploadPct} label="Progresso do envio" />
          </div>
        )}

        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy || !rights}>
            {busy && <Spinner />}
            {source === "url" ? "Importar vídeo" : "Enviar e importar"}
          </button>
          {upload && (
            <button type="button" className="btn btn-ghost" onClick={() => handleRef.current?.abort()}>
              Cancelar envio
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
