import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  api,
  extractDetail,
  setCsrfToken,
  setUnauthorizedHandler,
  uploadProject,
} from "./api";

function jsonResponse(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("api client", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    setCsrfToken("tok-123");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setCsrfToken(null);
    setUnauthorizedHandler(null);
  });

  it("uses same-origin /api and omits CSRF on GET", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));
    await api.listProjects();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/projects");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers["X-CSRF-Token"]).toBeUndefined();
  });

  it("sends X-CSRF-Token and JSON body on mutations", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "c1", revision: 4 }));
    await api.approveClip("c1", 3);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/clips/c1/approve");
    expect(init.method).toBe("POST");
    expect(init.headers["X-CSRF-Token"]).toBe("tok-123");
    expect(JSON.parse(init.body)).toEqual({ revision: 3 });
  });

  it("sends the exact publication reschedule contract", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await api.reschedulePublication("p1", "2030-01-01T10:00:00.000Z", "America/Sao_Paulo");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/publications/p1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({
      scheduled_at: "2030-01-01T10:00:00.000Z",
      timezone: "America/Sao_Paulo",
      confirmed: true,
    });
  });

  it("encodes path ids", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await api.getClip("../x");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/clips/..%2Fx");
  });

  it("raises ApiError with backend detail", async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { detail: "Revisão desatualizada" }));
    await expect(api.approveClip("c1", 1)).rejects.toMatchObject({
      status: 409,
      message: "Revisão desatualizada",
    });
  });

  it("calls the unauthorized handler on 401 except for auth probes", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(jsonResponse(401, { detail: "no" }));
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(jsonResponse(401, { detail: "no" }));
    await expect(api.listProjects()).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("maps network failures to status 0", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.listAccounts()).rejects.toMatchObject({ status: 0 });
  });

  it("handles 204 responses", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.deleteProject("p")).resolves.toBeUndefined();
  });

  it("forwards editing_instructions in createProjectFromUrl and defaults to empty string", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(201, { id: "p1", editing_instructions: "Focar em vendas" }),
    );
    await api.createProjectFromUrl({
      title: " Vídeo YouTube ",
      source_url: "https://youtu.be/dQw4w9WgXcQ",
      duration_seconds: 45,
      rights_confirmed: true,
      editing_instructions: "Focar em vendas",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/projects");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      title: " Vídeo YouTube ",
      source_url: "https://youtu.be/dQw4w9WgXcQ",
      duration_seconds: 45,
      rights_confirmed: true,
      editing_instructions: "Focar em vendas",
    });

    fetchMock.mockResolvedValue(jsonResponse(201, { id: "p2", editing_instructions: "" }));
    await api.createProjectFromUrl({
      title: "MP4 Direto",
      source_url: "https://cdn.example.com/v.mp4",
      duration_seconds: 30,
      rights_confirmed: true,
    });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({
      title: "MP4 Direto",
      source_url: "https://cdn.example.com/v.mp4",
      duration_seconds: 30,
      rights_confirmed: true,
      editing_instructions: "",
    });
  });

  it("forwards editing_instructions in multipart uploadProject FormData", async () => {
    let capturedForm: FormData | null = null;
    class FakeXHR {
      status = 201;
      responseText = JSON.stringify({ id: "up1", editing_instructions: "Priorizar perguntas" });
      withCredentials = false;
      upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open = vi.fn();
      setRequestHeader = vi.fn();
      send = vi.fn((body: FormData) => {
        capturedForm = body;
        this.onload?.();
      });
      abort = vi.fn();
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const file = new File(["mp4"], "aula.mp4", { type: "video/mp4" });
    const handle = uploadProject(
      {
        file,
        title: "Aula 1",
        duration_seconds: 60,
        rights_confirmed: true,
        editing_instructions: "Priorizar perguntas",
      },
      () => undefined,
    );
    await expect(handle.promise).resolves.toMatchObject({
      id: "up1",
      editing_instructions: "Priorizar perguntas",
    });
    expect(capturedForm).not.toBeNull();
    expect(capturedForm!.get("title")).toBe("Aula 1");
    expect(capturedForm!.get("duration_seconds")).toBe("60");
    expect(capturedForm!.get("rights_confirmed")).toBe("true");
    expect(capturedForm!.get("editing_instructions")).toBe("Priorizar perguntas");
  });
});

describe("extractDetail", () => {
  it("reads string detail", () => {
    expect(extractDetail({ detail: "x" }, 400)).toBe("x");
  });
  it("flattens FastAPI validation errors", () => {
    expect(
      extractDetail({ detail: [{ loc: ["body", "source_url"], msg: "URL inválida" }] }, 422),
    ).toBe("source_url: URL inválida");
  });
  it("falls back to status message", () => {
    expect(extractDetail(null, 503)).toMatch(/indisponível/);
  });
});
