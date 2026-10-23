import type { NextConfig } from "next";

/**
 * The browser always talks to the same origin (`/api/*`).
 * Requests are forwarded to the backend by the runtime route handler in
 * `src/app/api/[...path]/route.ts`, which reads the server-only `BACKEND_URL`
 * environment variable at request time (next.config rewrites would be frozen
 * at build time, which breaks a build-once/deploy-anywhere Docker image).
 */
const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
