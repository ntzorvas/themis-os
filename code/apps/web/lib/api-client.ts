/**
 * API fetch wrapper — attaches firm-slug header αυτόματα.
 *
 * Server-side: reads `x-firm-slug` από incoming request headers (set by middleware).
 * Client-side: reads `data-firm-slug` attribute που τίθεται στο layout.
 *
 * Χρήση από Server Components:
 *   import { serverFetch } from '@/lib/api-client';
 *   const data = await serverFetch('/api/v1/parties');
 *
 * Χρήση από Client Components:
 *   import { clientFetch } from '@/lib/api-client';
 *   const data = await clientFetch('/api/v1/parties', { method: 'POST', body: ... });
 *
 * @module lib/api-client
 */

import { headers } from 'next/headers';

// ---------------------------------------------------------------------------
// Server-side fetch (Server Components / Server Actions only)
// ---------------------------------------------------------------------------

/**
 * Wrapper για server-side fetch που προσθέτει αυτόματα το x-firm-slug header
 * διαβάζοντάς το από τα incoming request headers (τέθηκε από το middleware).
 */
export async function serverFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const requestHeaders = await headers();
  const firmSlug = requestHeaders.get('x-firm-slug');

  const mergedHeaders = new Headers(init.headers);
  mergedHeaders.set('Content-Type', 'application/json');
  if (firmSlug !== null) {
    mergedHeaders.set('x-firm-slug', firmSlug);
  }

  const baseUrl =
    process.env['INTERNAL_API_URL'] ??
    (typeof window === 'undefined' ? 'http://localhost:4000' : '');

  // Server-side: call Fastify directly (bypass Next.js rewrite overhead)
  const url = path.startsWith('http') ? path : `${baseUrl}${path}`;

  return fetch(url, {
    ...init,
    headers: mergedHeaders,
    // Cache: revalidate every 30s by default — caller may override
    next: { revalidate: 30, ...(init as { next?: object }).next },
  });
}

// ---------------------------------------------------------------------------
// Client-side fetch helper (Client Components)
// Uses Next.js rewrite proxy → /api/v1/* → Fastify
// firm-slug is read from the meta tag injected by the layout
// ---------------------------------------------------------------------------

function getFirmSlugFromMeta(): string | null {
  if (typeof document === 'undefined') return null;
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="x-firm-slug"]'
  );
  return meta?.content ?? null;
}

export interface ClientFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

/**
 * Client-side fetch wrapper.
 * Proxies through Next.js rewrites (/api/v1/* → Fastify).
 * Automatically attaches x-firm-slug from meta tag.
 *
 * Throws on non-ok responses with a structured ApiError.
 */
export async function clientFetch<T>(
  path: string,
  options: ClientFetchOptions = {}
): Promise<T> {
  const { body, headers: extraHeaders, ...rest } = options;

  const mergedHeaders = new Headers(extraHeaders);
  mergedHeaders.set('Content-Type', 'application/json');

  const firmSlug = getFirmSlugFromMeta();
  if (firmSlug !== null) {
    mergedHeaders.set('x-firm-slug', firmSlug);
  }

  const serializedBody = body !== undefined ? JSON.stringify(body) : null;
  const response = await fetch(path, {
    ...rest,
    headers: mergedHeaders,
    ...(serializedBody !== null && { body: serializedBody }),
  });

  if (!response.ok) {
    let errorBody: { code?: string; message?: string } = {};
    try {
      errorBody = (await response.json()) as { code?: string; message?: string };
    } catch {
      // ignore parse failures
    }
    throw new ApiClientError(
      errorBody.message ?? `Σφάλμα διακομιστή (${response.status})`,
      errorBody.code ?? 'UNKNOWN_ERROR',
      response.status
    );
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}
