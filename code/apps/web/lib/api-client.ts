/**
 * API fetch wrapper — client-side only.
 *
 * Server Components: import { serverFetch } from '@/lib/api-client-server';
 * Client Components: import { clientFetch } from '@/lib/api-client';
 *
 * @module lib/api-client
 */

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
