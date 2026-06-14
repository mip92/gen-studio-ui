import type { NextConfig } from "next";

const BACKEND = process.env.INTERNAL_API_BASE ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // Proxy browser API calls (/api/*) to the NestJS backend. This keeps the
  // frontend same-origin from any device on the LAN — no host is baked into
  // the client bundle, and no CORS is involved. The backend has no global
  // prefix, so the /api segment is stripped before forwarding.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND}/:path*` }];
  },
};

export default nextConfig;
