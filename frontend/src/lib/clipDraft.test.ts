import { describe, expect, it } from "vitest";
import {
  activeCue,
  buildPatch,
  draftFromClip,
  hasMissingTranslations,
  isDirty,
  joinColor,
  splitColor,
  validateCues,
} from "./clipDraft";
import type { Clip } from "./types";

const clip: Clip = {
  id: "c1",
  project_id: "p1",
  start_seconds: 10,
  end_seconds: 40,
  reason: "Momento forte",
  score: 0.9,
  status: "draft",
  revision: 2,
  subtitle_mode: "both",
  framing: { mode: "crop", offset_x: 0.5 },
  style: { font_size: 64, color: "#ffffff", outline_color: "#000000", background_color: "#00000099", position: "bottom" },
  cues: [
    { id: "a", start_seconds: 0, end_seconds: 2.5, original_text: "Hello", translated_text: "Olá" },
    { id: "b", start_seconds: 2.5, end_seconds: 5, original_text: "World", translated_text: "Mundo" },
  ],
  artifact_url: null,
  srt_url: null,
  error: null,
};

describe("clip draft", () => {
  it("starts clean and builds an empty patch", () => {
    const draft = draftFromClip(clip);
    expect(isDirty(clip, draft)).toBe(false);
    expect(buildPatch(clip, draft)).toEqual({});
  });

  it("sends only changed fields, preserving untouched data", () => {
    const draft = draftFromClip(clip);
    draft.cues[1]!.translated_text = "Mundo!";
    draft.style = { ...draft.style, position: "top" };
    const patch = buildPatch(clip, draft);
    expect(Object.keys(patch).sort()).toEqual(["cues", "style"]);
    expect(patch.cues![1]!.translated_text).toBe("Mundo!");
    expect(patch.cues![0]).toEqual(clip.cues[0]);
    expect(patch.style!.position).toBe("top");
  });

  it("does not mutate the server clip while editing", () => {
    const draft = draftFromClip(clip);
    draft.cues[0]!.original_text = "changed";
    draft.framing.offset_x = 0.1;
    expect(clip.cues[0]!.original_text).toBe("Hello");
    expect(clip.framing.offset_x).toBe(0.5);
  });

  it("sorts cues and rounds times in the patch", () => {
    const draft = draftFromClip(clip);
    draft.cues = [
      { id: "z", start_seconds: 3.33333, end_seconds: 4.1, original_text: "x", translated_text: "y" },
      ...draft.cues.slice(0, 1),
    ];
    const patch = buildPatch(clip, draft);
    expect(patch.cues!.map((c) => c.id)).toEqual(["a", "z"]);
    expect(patch.cues![1]!.start_seconds).toBe(3.333);
  });

  it("validates cue timing and required text per subtitle mode, including null translated_text", () => {
    const bad = [
      { id: "1", start_seconds: 3, end_seconds: 2, original_text: "a", translated_text: "b" },
      { id: "2", start_seconds: 0, end_seconds: 31, original_text: "a", translated_text: "b" },
      { id: "3", start_seconds: 1, end_seconds: 2, original_text: "a", translated_text: null },
    ];
    const issues = validateCues(bad, 30, "both");
    expect(issues.map((i) => i.id)).toEqual(["1", "2", "3"]);
    expect(validateCues([bad[2]!], 30, "original")).toEqual([]);
    expect(hasMissingTranslations([bad[2]!])).toBe(true);
    expect(hasMissingTranslations(clip.cues)).toBe(false);
  });

  it("finds the active cue at a local time", () => {
    expect(activeCue(clip.cues, 1)?.id).toBe("a");
    expect(activeCue(clip.cues, 2.5)?.id).toBe("b");
    expect(activeCue(clip.cues, 9)).toBeNull();
  });

  it("splits and joins colors with 8-digit #rrggbbaa alpha", () => {
    expect(splitColor("#00000099")).toEqual({ hex: "#000000", alpha: 0x99 / 255 });
    expect(splitColor("#FFF")).toEqual({ hex: "#ffffff", alpha: 1 });
    expect(joinColor("#112233", 1)).toBe("#112233ff");
    expect(joinColor("#112233", 0.6)).toBe("#11223399");
  });
});
