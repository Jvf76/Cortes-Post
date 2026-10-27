"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { OUTPUT_WIDTH, activeCue } from "@/lib/clipDraft";
import { formatTime } from "@/lib/format";
import type { Cue, Framing, SubtitleMode, SubtitleStyle } from "@/lib/types";
import { Alert } from "./ui";

export interface ClipPlayerHandle {
  /** Seek to a local clip time (seconds from clip start). */
  seek: (localSeconds: number) => void;
  currentLocalTime: () => number;
}

interface Props {
  sourceUrl: string;
  start: number;
  duration: number;
  framing: Framing;
  style: SubtitleStyle;
  mode: SubtitleMode;
  cues: Cue[];
  onLocalTime?: (t: number) => void;
  handleRef?: Ref<ClipPlayerHandle>;
}

/**
 * Previews the clip interval of the *source* video, simulating the vertical
 * 9:16 framing and burned subtitles. The final render is authoritative.
 */
export function ClipPlayer({
  sourceUrl,
  start,
  duration,
  framing,
  style,
  mode,
  cues,
  onLocalTime,
  handleRef,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [local, setLocal] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const [scale, setScale] = useState(0.33);
  const end = start + duration;

  // Clear stale media errors and readiness state whenever the source URL changes.
  useEffect(() => {
    setError(false);
    setReady(false);
    setPlaying(false);
  }, [sourceUrl]);

  function retryLoad() {
    setError(false);
    setReady(false);
    setPlaying(false);
    setReloadCount((c) => c + 1);
  }

  useImperativeHandle(handleRef, () => ({
    seek: (t: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = start + Math.min(Math.max(0, t), duration - 0.05);
    },
    currentLocalTime: () => local,
  }));

  // Scale subtitle font sizes from 1080px output width to the preview width.
  useEffect(() => {
    const node = frameRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(([entry]) => {
      if (entry) setScale(entry.contentRect.width / OUTPUT_WIDTH);
    });
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  // Keep the playhead inside the interval whenever the interval moves.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !ready) return;
    if (v.currentTime < start || v.currentTime >= end) v.currentTime = start;
  }, [start, end, ready]);

  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v) return;
    if (v.currentTime >= end) {
      v.pause();
      v.currentTime = start;
    } else if (v.currentTime < start - 0.25) {
      v.currentTime = start;
    }
    const t = Math.min(Math.max(0, v.currentTime - start), duration);
    setLocal(t);
    onLocalTime?.(t);
  }

  function toggle() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < start || v.currentTime >= end - 0.05) v.currentTime = start;
      void v.play().catch(() => setPlaying(false));
    } else {
      v.pause();
    }
  }

  const cue = activeCue(cues, local);
  const lines: { text: string; secondary: boolean }[] = [];
  if (cue) {
    const orig = (cue.original_text ?? "").trim();
    const tr = (cue.translated_text ?? "").trim();
    if ((mode === "original" || mode === "both") && orig)
      lines.push({ text: orig, secondary: false });
    if ((mode === "translated" || mode === "both") && tr)
      lines.push({ text: tr, secondary: mode === "both" });
  }
  const fontPx = Math.max(8, style.font_size * scale);
  const outline = Math.max(1, Math.round(fontPx / 14));
  const shadow = [
    `${outline}px 0 0 ${style.outline_color}`,
    `-${outline}px 0 0 ${style.outline_color}`,
    `0 ${outline}px 0 ${style.outline_color}`,
    `0 -${outline}px 0 ${style.outline_color}`,
  ].join(", ");

  return (
    <div>
      <div
        ref={frameRef}
        className={`player-frame ${framing.mode}`}
        aria-label="Pré-visualização vertical 9:16"
      >
        {error ? (
          <div className="center-state" style={{ position: "absolute", inset: 0, padding: 16 }}>
            <Alert
              tone="warning"
              title="Pré-visualização do vídeo original indisponível"
              action={
                <button type="button" className="btn btn-sm" onClick={retryLoad}>
                  Tentar recarregar vídeo
                </button>
              }
            >
              Não foi possível reproduzir o vídeo original no navegador (por exemplo, falha
              temporária ou formato não compatível com o navegador). Você ainda pode ajustar o
              intervalo, editar as legendas e aprovar o corte para gerar o MP4 compatível.
            </Alert>
          </div>
        ) : (
          <video
            key={`${sourceUrl}:${reloadCount}`}
            ref={videoRef}
            src={sourceUrl}
            preload="metadata"
            playsInline
            style={{ objectPosition: `${Math.round(framing.offset_x * 100)}% 50%` }}
            onLoadedMetadata={() => {
              setError(false);
              setReady(true);
              if (videoRef.current) videoRef.current.currentTime = start;
            }}
            onTimeUpdate={onTimeUpdate}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => {
              setPlaying(false);
              setReady(false);
              setError(true);
            }}
            onClick={toggle}
          />
        )}
        {lines.length > 0 && (
          <div className={`subtitle-overlay pos-${style.position}`} aria-hidden>
            {lines.map((line, i) => (
              <span
                key={i}
                className="subtitle-line"
                style={{
                  fontSize: line.secondary ? fontPx * 0.8 : fontPx,
                  color: style.color,
                  background: style.background_color,
                  textShadow: shadow,
                  opacity: line.secondary ? 0.92 : 1,
                }}
              >
                {line.text}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="player-controls">
        <button className="btn btn-sm" onClick={toggle} disabled={!ready || error} aria-label={playing ? "Pausar" : "Reproduzir"}>
          {playing ? "❚❚ Pausar" : "▶ Reproduzir"}
        </button>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => {
            if (videoRef.current) videoRef.current.currentTime = start;
          }}
          disabled={!ready || error}
        >
          ↺ Início
        </button>
        <span className="mono small muted" aria-live="off">
          {formatTime(local, true)} / {formatTime(duration)}
        </span>
      </div>
      <Timeline
        duration={duration}
        cues={cues}
        local={local}
        onSeek={(t) => {
          if (videoRef.current) videoRef.current.currentTime = start + t;
        }}
      />
    </div>
  );
}

function Timeline({
  duration,
  cues,
  local,
  onSeek,
}: {
  duration: number;
  cues: Cue[];
  local: number;
  onSeek: (t: number) => void;
}) {
  const pct = (t: number) => `${(Math.min(Math.max(t, 0), duration) / duration) * 100}%`;
  return (
    <div style={{ marginTop: 10 }}>
      <div
        className="timeline"
        role="slider"
        tabIndex={0}
        aria-label="Linha do tempo do corte"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={Math.round(local * 10) / 10}
        aria-valuetext={formatTime(local, true)}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onSeek(((e.clientX - rect.left) / rect.width) * duration);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onSeek(Math.min(duration, local + 1));
          if (e.key === "ArrowLeft") onSeek(Math.max(0, local - 1));
          if (e.key === "Home") onSeek(0);
        }}
      >
        {cues.map((c) => (
          <div
            key={c.id}
            className={`timeline-cue${local >= c.start_seconds && local < c.end_seconds ? " active" : ""}`}
            style={{ left: pct(c.start_seconds), width: `calc(${pct(c.end_seconds)} - ${pct(c.start_seconds)})` }}
          />
        ))}
        <div className="timeline-head" style={{ left: pct(local) }} />
      </div>
    </div>
  );
}
