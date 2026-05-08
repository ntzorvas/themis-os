/**
 * Server-only API fetch wrapper.
 * Split from api-client.ts so that `next/headers` is never imported
 * in client component bundles.
 *
 * Forwards both x-firm-slug and Authorization (Bearer JWT) from the
 * incoming request so the Fastify API can authenticate/resolve tenant.
 */

import { headers } from 'next/headers';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from './auth';

// Next.js extends RequestInit with a `next` option for ISR/cache control.
// We define a loose interface here so callers can pass `{ next: { revalidate: N } }`
// without TypeScript errors.
interface ServerFetchInit extends Omit<RequestInit, 'next'> {
  next?: { revalidate?: number | false; tags?: string[] };
}

export async function serverFetch(
  path: string,
  init: ServerFetchInit = {}
): Promise<Response> {
  const requestHeaders = await headers();
  const cookieStore = await cookies();
  const firmSlug = requestHeaders.get('x-firm-slug');
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;

  const mergedHeaders = new Headers(init.headers);
  mergedHeaders.set('Content-Type', 'application/json');
  if (firmSlug !== null) {
    mergedHeaders.set('x-firm-slug', firmSlug);
  }
  if (sessionToken) {
    mergedHeaders.set('Authorization', `Bearer ${sessionToken}`);
  }

  const baseUrl =
    process.env['INTERNAL_API_URL'] ??
    (typeof window === 'undefined' ? 'http://localhost:4100' : '');

  const url = path.startsWith('http') ? path : `${baseUrl}${path}`;

  const { next, ...restInit } = init;

  return fetch(url, {
    ...restInit,
    headers: mergedHeaders,
    // Next.js recognises the `next` property on fetch for ISR
    ...(next !== undefined && { next }),
  } as RequestInit);
}
