import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, extractDetail, setCsrfToken, setUnauthorizedHandler } from "./api";

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
