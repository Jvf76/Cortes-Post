// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { buildUpstreamUrl, proxyRequest, resolveBackendBase, rewriteLocation } from "./proxy";

describe("proxy", () => {
  it("returns 503 when BACKEND_URL is missing", async () => {
    const res = await proxyRequest(new Request("http://app.local/api/projects"), ["projects"], undefined);
    expect(res.status).toBe(503);
    expect((await res.json()).detail).toMatch(/BACKEND_URL/);
  });

  it("rejects traversal segments and keeps the configured host", () => {
    const base = resolveBackendBase("http://backend:8000/");
    expect(buildUpstreamUrl(base, ["..", "secret"], "")).toBeNull();
    expect(buildUpstreamUrl(base, ["a/b"], "")).toBeNull();
    const url = buildUpstreamUrl(base, ["projects", "abc"], "?x=1")!;
    expect(url.toString()).toBe("http://backend:8000/api/projects/abc?x=1");
  });

  it("forwards method, body, cookies, CSRF and Range; strips hop-by-hop", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("partial", {
        status: 206,
        headers: { "content-range": "bytes 0-6/100", "content-length": "7", connection: "keep-alive" },
      }),
    );
    const req = new Request("https://app.example.com/api/projects/p1/source?t=1", {
      method: "GET",
      headers: {
        cookie: "session=abc",
        range: "bytes=0-6",
        connection: "keep-alive",
        "accept-encoding": "gzip",
      },
    });
    const res = await proxyRequest(req, ["projects", "p1", "source"], "http://backend:8000", fetchImpl);
    const [target, init] = fetchImpl.mock.calls[0]!;
    expect(String(target)).toBe("http://backend:8000/api/projects/p1/source?t=1");
    const headers = init.headers as Headers;
    expect(headers.get("cookie")).toBe("session=abc");
    expect(headers.get("range")).toBe("bytes=0-6");
    expect(headers.get("connection")).toBeNull();
    expect(headers.get("accept-encoding")).toBe("identity");
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(init.redirect).toBe("manual");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-6/100");
    expect(res.headers.get("connection")).toBeNull();
    expect(await res.text()).toBe("partial");
  });

  it("streams request bodies for mutations with duplex half", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const req = new Request("http://app.local/api/clips/c1", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-csrf-token": "t" },
      body: JSON.stringify({ subtitle_mode: "both" }),
    });
    await proxyRequest(req, ["clips", "c1"], "http://backend:8000", fetchImpl);
    const init = fetchImpl.mock.calls[0]![1];
    expect(init.method).toBe("PATCH");
    expect(init.duplex).toBe("half");
    expect((init.headers as Headers).get("x-csrf-token")).toBe("t");
    expect(await new Response(init.body).text()).toBe('{"subtitle_mode":"both"}');
  });

  it("preserves multiple Set-Cookie headers and passes redirects through", async () => {
    const upstreamHeaders = new Headers();
    upstreamHeaders.append("set-cookie", "session=1; HttpOnly; Path=/");
    upstreamHeaders.append("set-cookie", "other=2; Path=/");
    upstreamHeaders.set("location", "http://backend:8000/contas?connected=1");
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: upstreamHeaders }));
    const res = await proxyRequest(
      new Request("http://app.local/api/accounts/youtube/callback?code=x"),
      ["accounts", "youtube", "callback"],
      "http://backend:8000",
      fetchImpl,
    );
    expect(res.status).toBe(302);
    expect(res.headers.getSetCookie()).toEqual(["session=1; HttpOnly; Path=/", "other=2; Path=/"]);
    expect(res.headers.get("location")).toBe("/contas?connected=1");
  });

  it("leaves external redirects (signed storage URLs) untouched", () => {
    const base = resolveBackendBase("http://backend:8000");
    expect(rewriteLocation("https://s3.example.com/obj?sig=1", base)).toBe("https://s3.example.com/obj?sig=1");
  });

  it("returns 502 when the backend is unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await proxyRequest(new Request("http://app.local/api/health"), ["health"], "http://backend:8000", fetchImpl);
    expect(res.status).toBe(502);
  });

  it("rejects non-http BACKEND_URL schemes", async () => {
    const res = await proxyRequest(new Request("http://app.local/api/health"), ["health"], "file:///etc/passwd");
    expect(res.status).toBe(503);
  });
});
