import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthForm } from "./AuthForm";
import { CueEditor, FramingPanel, StylePanel } from "./ClipEditorPanels";
import { ClipPlayer } from "./ClipPlayer";
import {
  buildPublicationPayload,
  validatePublishForm,
  type PublishFormState,
} from "./PublishDialog";
import type { Account, Clip, Cue } from "@/lib/types";

const sampleCues: Cue[] = [
  {
    id: "cue-1",
    start_seconds: 0,
    end_seconds: 4,
    original_text: "Texto original",
    translated_text: null,
  },
];

describe("ClipPlayer and ClipEditorPanels", () => {
  it("renders safely when translated_text is null across subtitle modes and applies framing", () => {
    const { container, rerender } = render(
      <ClipPlayer
        sourceUrl="/api/projects/p1/source"
        start={10}
        duration={30}
        framing={{ mode: "crop", offset_x: 0.25 }}
        style={{
          font_size: 48,
          color: "#FFFFFF",
          outline_color: "#000000",
          background_color: "#00000080",
          position: "bottom",
        }}
        mode="both"
        cues={sampleCues}
      />,
    );

    expect(screen.getByText("Texto original")).toBeInTheDocument();
    const video = container.querySelector("video")!;
    expect(video.style.objectPosition).toBe("25% 50%");

    rerender(
      <ClipPlayer
        sourceUrl="/api/projects/p1/source"
        start={10}
        duration={30}
        framing={{ mode: "contain", offset_x: 0.5 }}
        style={{
          font_size: 48,
          color: "#FFFFFF",
          outline_color: "#000000",
          background_color: "#00000080",
          position: "top",
        }}
        mode="translated"
        cues={sampleCues}
      />,
    );
    expect(screen.queryByText("Texto original")).toBeNull();
  });

  it("allows editing cues with null translated_text and emits 8-digit #rrggbbaa background", () => {
    const onCues = vi.fn();
    render(
      <CueEditor
        cues={sampleCues}
        onChange={onCues}
        duration={30}
        localTime={1}
        onSeek={() => undefined}
        issues={[]}
      />,
    );
    const trInput = screen.getByLabelText("Tradução pt-BR") as HTMLTextAreaElement;
    expect(trInput.value).toBe("");
    fireEvent.change(trInput, { target: { value: "Texto traduzido" } });
    expect(onCues).toHaveBeenCalledWith([
      expect.objectContaining({ id: "cue-1", translated_text: "Texto traduzido" }),
    ]);

    const onStyle = vi.fn();
    render(
      <StylePanel
        value={{
          font_size: 48,
          color: "#ffffff",
          outline_color: "#000000",
          background_color: "#00000080",
          position: "bottom",
        }}
        onChange={onStyle}
      />,
    );
    const alphaSlider = screen.getByLabelText(/Opacidade do fundo/i);
    fireEvent.change(alphaSlider, { target: { value: "100" } });
    expect(onStyle).toHaveBeenCalledWith(
      expect.objectContaining({ background_color: "#000000ff" }),
    );

    const onFraming = vi.fn();
    render(<FramingPanel value={{ mode: "crop", offset_x: 0.5 }} onChange={onFraming} />);
    fireEvent.click(screen.getByRole("radio", { name: /Conter/i }));
    expect(onFraming).toHaveBeenCalledWith({ mode: "contain", offset_x: 0.5 });
  });
});

describe("PublishDialog validation and payload", () => {
  const account: Account = {
    id: "acc-1",
    platform: "youtube",
    display_name: "Canal Teste",
    connected: true,
    first_publish_confirmed: false,
  };
  const clip: Clip = {
    id: "clip-1",
    project_id: "proj-1",
    start_seconds: 0,
    end_seconds: 30,
    reason: "Teste",
    score: 0.9,
    status: "ready",
    revision: 3,
    subtitle_mode: "original",
    framing: { mode: "crop", offset_x: 0.5 },
    style: {
      font_size: 48,
      color: "#FFFFFF",
      outline_color: "#000000",
      background_color: "#00000080",
      position: "bottom",
    },
    cues: [],
    artifact_url: "/api/clips/clip-1/download",
    srt_url: "/api/clips/clip-1/subtitles",
    error: null,
  };
  const baseForm: PublishFormState = {
    accountId: "acc-1",
    title: "Meu Short",
    description: "Descrição",
    hashtags: "#shorts #teste",
    visibility: "private",
    madeForKids: false,
    synthetic: false,
    when: "now",
    scheduledLocal: "2030-01-01T12:00",
    confirmFirst: false,
  };

  it("requires explicit first-publish confirmation when account is unconfirmed", () => {
    expect(validatePublishForm(baseForm, account)).toMatch(/primeira publicação/i);
    expect(validatePublishForm({ ...baseForm, confirmFirst: true }, account)).toBeNull();
  });

  it("builds contract-compliant publication payload with pinned revision", () => {
    const payload = buildPublicationPayload(
      { ...baseForm, confirmFirst: true },
      clip,
      "America/Sao_Paulo",
    );
    expect(payload).toEqual({
      clip_id: "clip-1",
      revision: 3,
      account_id: "acc-1",
      title: "Meu Short",
      description: "Descrição",
      hashtags: ["shorts", "teste"],
      visibility: "private",
      made_for_kids: false,
      contains_synthetic_media: false,
      scheduled_at: null,
      timezone: "America/Sao_Paulo",
      confirm_first_publish: true,
      confirmed: true,
    });
  });
});

describe("AuthForm password policy", () => {
  it("enforces minimum 10 characters on registration", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AuthForm onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("tab", { name: "Criar conta" }));
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "u@example.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "123456789" } });
    fireEvent.change(screen.getByLabelText("Confirmar senha"), { target: { value: "123456789" } });
    fireEvent.submit(screen.getByRole("button", { name: "Criar conta" }).closest("form")!);
    expect(await screen.findByText(/pelo menos 10 caracteres/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
