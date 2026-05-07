/**
 * Server-side auth helpers for Next.js App Router.
 *
 * All functions are server-only (reads cookies — not available in RSC by default
 * without next/headers). Call from Server Components or Server Actions.
 *
 * Cookie: `themisos_session` — httpOnly, Secure, SameSite=Lax
 *
 * @module lib/auth
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyToken, type ThemisJwtPayload } from './jwt-verify';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = 'themisos_session';
export const LOGIN_PATH = '/login';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Session {
  token: string;
  payload: ThemisJwtPayload;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reads the session cookie and verifies the JWT.
 * Returns the session if valid, null otherwise.
 *
 * Does NOT redirect — callers decide what to do on missing session.
 *
 * @example
 * const session = await getSession();
 * if (!session) return <LoginPrompt />;
 */
export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }

  const result = await verifyToken(token);
  if (!result.ok) {
    return null;
  }

  return { token, payload: result.payload };
}

/**
 * Asserts an authenticated session exists.
 * Redirects to /login if not authenticated.
 *
 * Use this at the top of protected Server Components / pages.
 *
 * @example
 * const session = await requireAuth();
 * // session is guaranteed non-null here
 */
export async function requireAuth(): Promise<Session> {
  const session = await getSession();
  if (session === null) {
    redirect(LOGIN_PATH);
  }
  return session;
}

/**
 * Sets the session cookie with secure defaults.
 * Call from Server Actions (after a successful API login).
 *
 * @param token - Raw JWT string returned by POST /api/v1/auth/login
 * @param expiresInSeconds - Lifetime in seconds (default: 8 hours)
 */
export async function setSessionCookie(
  token: string,
  expiresInSeconds = 8 * 60 * 60
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: expiresInSeconds,
  });
}

/**
 * Clears the session cookie.
 * Call from Server Actions on logout.
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
