import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Canonical URL form for project segments: `/projects/<uuid>/...`, always.
 * Manual addresses like `/projects/last_shift/scenes` get a 308 redirect to
 * their UUID equivalent — `params.id` downstream is therefore guaranteed to
 * be a UUID, and every Link/href the app emits keeps the browser address bar
 * on one canonical id.
 *
 * This proxy fetches /projects once per request when a slug is detected.
 * Hit rate is tiny (only when a user types or pastes a slug URL); routine
 * navigation already uses UUIDs and short-circuits past the API call.
 *
 * NOTE: this is the `proxy` file convention (Next.js v16 renamed `middleware`
 * → `proxy`). Behaviour is identical to the old middleware.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Middleware runs server-side only — talk straight to the backend (never the
// relative '/api', which has no meaning here).
const API_BASE = process.env.INTERNAL_API_BASE ?? 'http://localhost:4000';

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only intercept /projects/<seg>/... — leave /, /projects, /characters, /queue alone.
  const m = pathname.match(/^\/projects\/([^/]+)(\/.*)?$/);
  if (!m) return NextResponse.next();

  const seg  = m[1];
  const rest = m[2] ?? '';

  // Already canonical — pass through.
  if (UUID_RE.test(seg)) return NextResponse.next();

  // Slug (or unknown id). Look up the UUID.
  try {
    const res = await fetch(`${API_BASE}/projects`, { cache: 'no-store' });
    if (!res.ok) return NextResponse.next();
    const list = (await res.json()) as Array<{ id: string; slug: string }>;
    const found = list.find((p) => p.slug === seg);
    if (!found) return NextResponse.next();   // unknown — let the page render its own 404

    const url = req.nextUrl.clone();
    url.pathname = `/projects/${found.id}${rest}`;
    return NextResponse.redirect(url, 308);
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  // Only run for /projects/* routes; everything else skips the proxy for free.
  matcher: ['/projects/:path*'],
};
