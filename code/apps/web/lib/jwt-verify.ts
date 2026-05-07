/**
 * JWT verification for Next.js server-side code.
 *
 * Uses `jose` (JOSE standard library) to verify tokens issued by the Fastify API.
 * Phase 1: HS256 with shared JWT_SECRET env var.
 * Phase 2: Migrate to RS256 (asymmetric) — Fastify signs with private key,
 *   Next.js verifies with public key distributed via JWKS endpoint.
 *
 * NEVER import this file in client components — server-only.
 * @module lib/jwt-verify
 */

import { jwtVerify, type JWTPayload } from 'jose';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Decoded payload shape matching what Fastify's auth routes issue */
export interface ThemisJwtPayload extends JWTPayload {
  /** User UUID */
  sub: string;
  /** Firm UUID */
  firm: string;
  /** Firm slug (for subdomain resolution) */
  firm_slug: string;
  /** User role within the firm */
  role: string;
  /** JWT ID — used for session revocation lookup */
  jti: string;
}

export interface VerifyResult {
  ok: true;
  payload: ThemisJwtPayload;
}

export interface VerifyError {
  ok: false;
  reason: 'expired' | 'invalid' | 'missing_secret';
}

export type VerifyOutcome = VerifyResult | VerifyError;

// ---------------------------------------------------------------------------
// Secret derivation
// ---------------------------------------------------------------------------

function getSecret(): Uint8Array {
  const secret = process.env['JWT_SECRET'];
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('JWT_SECRET is not set. Cannot verify tokens.');
  }
  return new TextEncoder().encode(secret);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verifies a JWT token string using the shared HS256 secret.
 *
 * @param token - Raw JWT string (without "Bearer " prefix)
 * @returns VerifyOutcome — discriminated union, check `.ok` before using `.payload`
 *
 * @example
 * const result = await verifyToken(token);
 * if (!result.ok) redirect('/login');
 * const { sub, firm_slug } = result.payload;
 */
export async function verifyToken(token: string): Promise<VerifyOutcome> {
  let secret: Uint8Array;
  try {
    secret = getSecret();
  } catch {
    return { ok: false, reason: 'missing_secret' };
  }

  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    });

    // Runtime shape validation — jose does not enforce custom claims
    if (
      typeof payload['sub'] !== 'string' ||
      typeof payload['firm'] !== 'string' ||
      typeof payload['firm_slug'] !== 'string' ||
      typeof payload['role'] !== 'string' ||
      typeof payload['jti'] !== 'string'
    ) {
      return { ok: false, reason: 'invalid' };
    }

    return {
      ok: true,
      payload: payload as ThemisJwtPayload,
    };
  } catch (err: unknown) {
    const errName = (err as { name?: string }).name ?? '';
    if (errName === 'JWTExpired') {
      return { ok: false, reason: 'expired' };
    }
    return { ok: false, reason: 'invalid' };
  }
}
