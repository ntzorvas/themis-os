import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from './lib/jwt-verify';
import { SESSION_COOKIE } from './lib/auth';

// Subdomain tenant resolver + auth guard middleware
// Παράδειγμα: acme.themisos.gr → firm_slug = "acme"
// Auth: protected routes redirect to /login if no valid session cookie
// Αναλυτικά: docs/v03/api-architecture-v03.md §D-API-7

const PRODUCT_DOMAIN = process.env['PRODUCT_DOMAIN'] ?? 'themisos.gr';

// Subdomains that do not correspond to tenants
const RESERVED_SUBDOMAINS = new Set([
  'www',
  'app',
  'api',
  'staging',
  'status',
  'mail',
  'portal',
  'static',
]);

/**
 * Routes that do NOT require authentication.
 * Exact matches (no trailing wildcard) and prefix matches (ending with /).
 */
const PUBLIC_PATHS = [
  '/',                    // landing page
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/api/v1/auth/',        // all auth API sub-paths (proxied to Fastify, but matched here too)
  '/_next/',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
];

function isPublicPath(pathname: string): boolean {
  for (const pattern of PUBLIC_PATHS) {
    if (pattern.endsWith('/')) {
      if (pathname.startsWith(pattern)) return true;
    } else {
      if (pathname === pattern) return true;
    }
  }
  return false;
}

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') ?? '';
  const url = request.nextUrl.clone();
  const pathname = url.pathname;

  // Strip port for local development
  const host = hostname.replace(/:\d+$/, '');

  // -----------------------------------------------------------------------
  // 1. Subdomain tenant resolution
  // -----------------------------------------------------------------------
  const isSubdomain =
    host.endsWith(`.${PRODUCT_DOMAIN}`) &&
    host !== PRODUCT_DOMAIN &&
    host !== `www.${PRODUCT_DOMAIN}`;

  let firmSlug: string | null = null;

  if (isSubdomain) {
    firmSlug = host.replace(`.${PRODUCT_DOMAIN}`, '');

    // Reserved subdomains → pass through without tenant context
    if (RESERVED_SUBDOMAINS.has(firmSlug)) {
      firmSlug = null;
    }
  }

  // Redirect www → apex
  if (host === `www.${PRODUCT_DOMAIN}`) {
    url.host = PRODUCT_DOMAIN;
    return NextResponse.redirect(url, { status: 301 });
  }

  // -----------------------------------------------------------------------
  // 2. Auth guard for protected routes
  // -----------------------------------------------------------------------
  if (!isPublicPath(pathname)) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;

    let authenticated = false;

    if (typeof token === 'string' && token.length > 0) {
      const result = await verifyToken(token);
      authenticated = result.ok;
    }

    if (!authenticated) {
      // Redirect to login, preserving the intended destination
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('callbackUrl', pathname);
      const response = NextResponse.redirect(loginUrl);
      // Clear stale cookie if present
      if (request.cookies.has(SESSION_COOKIE)) {
        response.cookies.delete(SESSION_COOKIE);
      }
      return response;
    }
  }

  // -----------------------------------------------------------------------
  // 3. Pass through with firm-slug header (used by Server Components)
  // -----------------------------------------------------------------------
  const response = NextResponse.next();
  if (firmSlug !== null) {
    response.headers.set('x-firm-slug', firmSlug);
  }
  return response;
}

export const config = {
  matcher: [
    // Exclude static files and Next.js internals from middleware execution
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
