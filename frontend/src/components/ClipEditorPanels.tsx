"use client";

import { useEffect, useState } from "react";
import { joinColor, newCueId, splitColor, type CueIssue } from "@/lib/clipDraft";
import { formatTime, parseTime } from "@/lib/format";
import type { Cue, Framing, SubtitleMode, SubtitleStyle } from "@/lib/types";

/* ---------- Time input (m:ss.d) committing on blur ---------- */

export function TimeInput({
  id,
  value,
  onCommit,
  disabled,
  label,
}: {
  id: string;
  value: number;
  onCommit: (seconds: number) => void;
  disabled?: boolean;
  label: string;
}) {
  const [text, setText] = useState(formatTime(value, true));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(formatTime(value, true));
    setInvalid(false);
  }, [value]);
  const commit = () => {
    const parsed = parseTime(text);
    if (parsed == null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onCommit(parsed);
  };
  return (
    <input
      id={id}
      aria-label={label}
      className="input input-sm mono"
      value={text}
      disabled={disabled}
      aria-invalid={invalid}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

/* ---------- Subtitle mode ---------- */

const MODES: { value: SubtitleMode; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "translated", label: "Tradução pt-BR" },
  { value: "both", label: "Ambas" },
];

export function SubtitleModePicker({
  value,
  onChange,
}: {
  value: SubtitleMode;
  onChange: (v: SubtitleMode) => void;
}) {
  return (
    <div className="field">
      <span className="label" id="mode-label">
        Legendas exibidas
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby="mode-label">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={value === m.value}
            onClick={() => onChange(m.value)}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- Style ---------- */

export function StylePanel({
  value,
  onChange,
}: {
  value: SubtitleStyle;
  onChange: (v: SubtitleStyle) => void;
}) {
  const bg = splitColor(value.background_color);
  const set = <K extends keyof SubtitleStyle>(key: K, v: SubtitleStyle[K]) =>
    onChange({ ...value, [key]: v });
  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="style-size">Tamanho da fonte: {value.font_size}px</label>
        <input
          id="style-size"
          type="range"
          min={16}
          max={96}
          step={1}
          value={value.font_size}
          onChange={(e) => set("font_size", Number(e.target.value))}
        />
        <span className="hint">Em pixels no vídeo final (1080×1920, de 16 a 96 px).</span>
      </div>
      <div className="swatch-row">
        <div className="field">
          <label htmlFor="style-color">Texto</label>
          <input
            id="style-color"
            type="color"
            className="input"
            value={splitColor(value.color).hex}
            onChange={(e) => set("color", e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="style-outline">Contorno</label>
          <input
            id="style-outline"
            type="color"
            className="input"
            value={splitColor(value.outline_color).hex}
            onChange={(e) => set("outline_color", e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="style-bg">Fundo</label>
          <input
            id="style-bg"
            type="color"
            className="input"
            value={bg.hex}
            onChange={(e) => set("background_color", joinColor(e.target.value, bg.alpha))}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="style-bg-alpha">Opacidade do fundo: {Math.round(bg.alpha * 100)}%</label>
        <input
          id="style-bg-alpha"
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(bg.alpha * 100)}
          onChange={(e) => set("background_color", joinColor(bg.hex, Number(e.target.value) / 100))}
        />
      </div>
      <div className="field">
        <span className="label" id="pos-label">
          Posição
        </span>
        <div className="segmented" role="radiogroup" aria-labelledby="pos-label">
          {(
            [
              ["top", "Topo"],
              ["center", "Centro"],
              ["bottom", "Base"],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={value.position === v}
              onClick={() => set("position", v)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Framing ---------- */

export function FramingPanel({ value, onChange }: { value: Framing; onChange: (v: Framing) => void }) {
  return (
    <div className="stack">
      <div className="field">
        <span className="label" id="framing-label">
          Enquadramento vertical
        </span>
        <div className="segmented" role="radiogroup" aria-labelledby="framing-label">
          <button
            type="button"
            role="radio"
            aria-checked={value.mode === "crop"}
            onClick={() => onChange({ ...value, mode: "crop" })}
          >
            Recortar (preencher)
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={value.mode === "contain"}
            onClick={() => onChange({ ...value, mode: "contain" })}
          >
            Conter (faixas)
          </button>
        </div>
      </div>
      <div className="field">
        <label htmlFor="framing-offset">
          Posição horizontal: {Math.round(value.offset_x * 100)}%
        </label>
        <input
          id="framing-offset"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value.offset_x}
          disabled={value.mode !== "crop"}
          onChange={(e) => onChange({ ...value, offset_x: Number(e.target.value) })}
          aria-describedby="framing-offset-hint"
        />
        <span id="framing-offset-hint" className="hint">
          {value.mode === "crop"
            ? "0% = esquerda, 50% = centro, 100% = direita."
            : "Disponível apenas no modo recortar."}
        </span>
      </div>
    </div>
  );
}

/* ---------- Cues ---------- */

export function CueEditor({
  cues,
  onChange,
  duration,
  localTime,
  onSeek,
  disabled,
  issues,
}: {
  cues: Cue[];
  onChange: (cues: Cue[]) => void;
  duration: number;
  localTime: number;
  onSeek: (t: number) => void;
  disabled?: boolean;
  issues: CueIssue[];
}) {
  const update = (id: string, patch: Partial<Cue>) =>
    onChange(cues.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const remove = (id: string) => onChange(cues.filter((c) => c.id !== id));
  const add = () => {
    const start = Math.min(Math.max(0, Math.round(localTime * 10) / 10), Math.max(0, duration - 0.5));
    const end = Math.min(duration, start + 2);
    const cue: Cue = { id: newCueId(), start_seconds: start, end_seconds: end, original_text: "", translated_text: "" };
    onChange([...cues, cue].sort((a, b) => a.start_seconds - b.start_seconds));
  };

  return (
    <div className="stack">
      <div className="row-between">
        <span className="muted small">
          {cues.length} {cues.length === 1 ? "legenda" : "legendas"} · tempos relativos ao início do corte
        </span>
        <button type="button" className="btn btn-sm" onClick={add} disabled={disabled}>
          + Adicionar na posição atual
        </button>
      </div>
      {cues.length === 0 ? (
        <div className="empty">Nenhuma legenda neste corte.</div>
      ) : (
        <div className="cue-list">
          {cues.map((cue, i) => {
            const active = localTime >= cue.start_seconds && localTime < cue.end_seconds;
            const cueIssues = issues.filter((x) => x.id === cue.id);
            return (
              <div key={cue.id} className={`cue-row${active ? " active" : ""}`}>
                <div className="cue-times">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onSeek(cue.start_seconds)}
                    aria-label={`Ir para a legenda ${i + 1}`}
                  >
                    ▶ #{i + 1}
                  </button>
                  <TimeInput
                    id={`cue-${cue.id}-start`}
                    label={`Início da legenda ${i + 1}`}
                    value={cue.start_seconds}
                    disabled={disabled}
                    onCommit={(v) => update(cue.id, { start_seconds: v })}
                  />
                  <TimeInput
                    id={`cue-${cue.id}-end`}
                    label={`Fim da legenda ${i + 1}`}
                    value={cue.end_seconds}
                    disabled={disabled}
                    onCommit={(v) => update(cue.id, { end_seconds: v })}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`cue-${cue.id}-orig`} className="hint">
                    Original
                  </label>
                  <textarea
                    id={`cue-${cue.id}-orig`}
                    className="textarea"
                    rows={2}
                    value={cue.original_text}
                    disabled={disabled}
                    aria-invalid={cueIssues.length > 0}
                    onChange={(e) => update(cue.id, { original_text: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`cue-${cue.id}-tr`} className="hint">
                    Tradução pt-BR
                  </label>
                  <textarea
                    id={`cue-${cue.id}-tr`}
                    className="textarea"
                    rows={2}
                    value={cue.translated_text ?? ""}
                    placeholder={
                      cue.translated_text == null
                        ? "Tradução automática indisponível — digite manualmente se desejar"
                        : undefined
                    }
                    disabled={disabled}
                    aria-invalid={cueIssues.length > 0}
                    onChange={(e) => update(cue.id, { translated_text: e.target.value })}
                  />
                  {cueIssues.map((x, k) => (
                    <span key={k} className="field-error">
                      {x.message}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => remove(cue.id)}
                  disabled={disabled}
                  aria-label={`Remover legenda ${i + 1}`}
                  title="Remover"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
