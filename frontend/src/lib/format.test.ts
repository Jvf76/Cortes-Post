import { describe, expect, it } from "vitest";
import {
  clampPercent,
  formatTime,
  isHttpsUrl,
  localInputToUtcIso,
  parseHashtags,
  parseTime,
} from "./format";

describe("format", () => {
  it("formats and parses clip times", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(75.4, true)).toBe("1:15.4");
    expect(formatTime(3725)).toBe("1:02:05");
    expect(formatTime(null)).toBe("—");
    expect(parseTime("1:15.4")).toBeCloseTo(75.4);
    expect(parseTime("1:02:05")).toBe(3725);
    expect(parseTime("12,5")).toBe(12.5);
    expect(parseTime("abc")).toBeNull();
    expect(parseTime("")).toBeNull();
    expect(parseTime("1:2:3:4")).toBeNull();
  });

  it("never invents progress: null stays null, numbers are clamped 0..100", () => {
    expect(clampPercent(null)).toBeNull();
    expect(clampPercent(Number.NaN)).toBeNull();
    expect(clampPercent(42)).toBe(42);
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(-3)).toBe(0);
  });

  it("accepts only credential-free HTTPS urls", () => {
    expect(isHttpsUrl("https://cdn.example.com/v.mp4")).toBe(true);
    expect(isHttpsUrl("http://cdn.example.com/v.mp4")).toBe(false);
    expect(isHttpsUrl("https://user:pw@example.com/v.mp4")).toBe(false);
    expect(isHttpsUrl("ftp://example.com")).toBe(false);
    expect(isHttpsUrl("not a url")).toBe(false);
  });

  it("normalizes hashtags", () => {
    expect(parseHashtags("#shorts, #Corte corte  ##viral")).toEqual(["shorts", "Corte", "viral"]);
    expect(parseHashtags("   ")).toEqual([]);
  });

  it("converts datetime-local to UTC ISO", () => {
    const iso = localInputToUtcIso("2030-01-02T03:04");
    expect(iso).toMatch(/^2030-01-0[12]T\d\d:04:00\.000Z$/);
    expect(new Date(iso!).getTime()).toBe(new Date("2030-01-02T03:04").getTime());
    expect(localInputToUtcIso("")).toBeNull();
  });
});
