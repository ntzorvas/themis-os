'use server';

/**
 * Server Actions for the login flow.
 *
 * Server Actions run on the server, so they can set httpOnly cookies
 * that are not accessible to client-side JavaScript.
 */

import { setSessionCookie, clearSessionCookie } from '../../../lib/auth';

/**
 * Stores the session JWT in an httpOnly cookie.
 * Called from LoginForm after a successful API response.
 *
 * @param token - Raw JWT string returned by POST /api/v1/auth/login
 */
export async function storeSessionAction(token: string): Promise<void> {
  await setSessionCookie(token);
}

/**
 * Clears the session cookie.
 * Called from logout buttons/forms.
 */
export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
}
