/**
 * Server-side same-origin proxy for `/api/*` → `${BACKEND_URL}/api/*`.
 *
 * - Upstream is fixed by server env; the client path can never change the host.
 * - Request/response bodies are streamed (large uploads, Range video responses).
 * - Redirects are passed through manually (OAuth / signed storage URLs).
 * - Hop-by-hop headers are stripped in both directions; Set-Cookie preserved.
 */

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "expect",
]);

export class ProxyConfigError extends Error {}

export function resolveBackendBase(raw: string | undefined): URL {
  if (!raw || !raw.trim()) throw new ProxyConfigError("BACKEND_URL não configurado");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ProxyConfigError("BACKEND_URL inválido");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProxyConfigError("BACKEND_URL deve usar http ou https");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

/** Builds the upstream URL from validated path segments; rejects traversal. */
export function buildUpstreamUrl(base: URL, segments: string[], search: string): URL | null {
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === ".." || seg.includes("/") || seg.includes("\\")) {
      return null;
    }
  }
  const encoded = segments.map((s) => encodeURIComponent(s)).join("/");
  const target = new URL(base.toString());
  const prefix = base.pathname.replace(/\/+$/, "");
  target.pathname = `${prefix}/api/${encoded}`;
  target.search = search;
  return target;
}

function forwardRequestHeaders(incoming: Headers, requestUrl: URL): Headers {
  const out = new Headers();
  const connectionTokens = (incoming.get("connection") ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  incoming.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k) || connectionTokens.includes(k)) return;
    if (k === "accept-encoding") return;
    out.set(key, value);
  });
  // Ask for identity so Content-Length/Range semantics are preserved verbatim.
  out.set("accept-encoding", "identity");
  out.set("x-forwarded-host", requestUrl.host);
  out.set("x-forwarded-proto", requestUrl.protocol.replace(":", ""));
  return out;
}

function forwardResponseHeaders(upstream: Response, base: URL): Headers {
  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k) || k === "set-cookie") return;
    if (k === "location") {
      out.set(key, rewriteLocation(value, base));
      return;
    }
    out.set(key, value);
  });
  const cookies =
    typeof upstream.headers.getSetCookie === "function" ? upstream.headers.getSetCookie() : [];
  for (const cookie of cookies) out.append("set-cookie", cookie);
  // If the runtime transparently decoded a compressed body, length/encoding are stale.
  if (out.has("content-encoding") && out.get("content-encoding") !== "identity") {
    out.delete("content-encoding");
    out.delete("content-length");
  }
  return out;
}

/** Backend-absolute redirects become same-origin relative; others untouched. */
export function rewriteLocation(location: string, base: URL): string {
  try {
    const target = new URL(location, base);
    if (target.origin === base.origin) {
      return `${target.pathname}${target.search}${target.hash}`;
    }
  } catch {
    // keep as-is
  }
  return location;
}

export type FetchLike = (input: URL | string, init: RequestInit & { duplex?: "half" }) => Promise<Response>;

export async function proxyRequest(
  request: Request,
  segments: string[],
  backendUrl: string | undefined,
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<Response> {
  let base: URL;
  try {
    base = resolveBackendBase(backendUrl);
  } catch (err) {
    const detail = err instanceof ProxyConfigError ? err.message : "Proxy mal configurado";
    return Response.json({ detail: `Servidor de API indisponível: ${detail}.` }, { status: 503 });
  }

  const requestUrl = new URL(request.url);
  const target = buildUpstreamUrl(base, segments, requestUrl.search);
  if (!target) return Response.json({ detail: "Caminho inválido." }, { status: 400 });

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD" && request.body !== null;

  let upstream: Response;
  try {
    upstream = await fetchImpl(target, {
      method,
      headers: forwardRequestHeaders(request.headers, requestUrl),
      body: hasBody ? request.body : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: request.signal,
      ...(hasBody ? { duplex: "half" as const } : {}),
    });
  } catch {
    return Response.json(
      { detail: "Não foi possível alcançar o servidor de API. Tente novamente em instantes." },
      { status: 502 },
    );
  }

  const nullBody = method === "HEAD" || [101, 204, 205, 304].includes(upstream.status);
  return new Response(nullBody ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: forwardResponseHeaders(upstream, base),
  });
}
