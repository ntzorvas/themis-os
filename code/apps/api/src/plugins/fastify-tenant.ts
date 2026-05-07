/**
 * Fastify tenant resolution plugin
 * Resolves request.firmContext from JWT, header, or subdomain.
 * Enforces tenant isolation at the request boundary.
 *
 * Order of resolution: JWT → x-firm-slug header → subdomain
 * Cached in-memory with CACHE_TTL_MS TTL (default 60 s, env-configurable).
 *
 * @module fastify-tenant
 *
 * // 2026-04-29 fix-pass: C2, M3, M7, M8, M9, N11
 *
 * @usage
 * ```ts
 * // In server.ts — register AFTER @fastify/jwt
 * import tenantPlugin from './plugins/fastify-tenant.js';
 * await fastify.register(jwtPlugin, { secret: process.env.JWT_SECRET });
 * await fastify.register(tenantPlugin);
 * ```
 *
 * @exemptRoutes
 * The following paths bypass tenant resolution and leave firmContext null.
 * Exact matches and prefix matches (suffix `*`) are both supported.
 * Additionally, the following path prefixes use startsWith() matching because
 * they carry a dynamic token segment (e.g. /verify-email/:token):
 *   - /api/v1/auth/verify-email
 *   - /api/v1/auth/reset-password
 *
 *   - /health
 *   - /healthz
 *   - /readyz
 *   - /metrics
 *   - /api/v1/auth/login
 *   - /api/v1/auth/register-firm
 *   - /api/v1/auth/forgot-password
 *   - /api/v1/auth/refresh
 *   - /api/v1/auth/verify-email  (prefix)
 *   - /api/v1/auth/reset-password (prefix)
 *   - /api/v1/public/* (prefix match)
 *
 * @cacheBehavior
 * Resolved FirmContext objects are cached by firm_slug in a module-level Map.
 * Each entry carries a timestamp; entries older than CACHE_TTL_MS are
 * re-fetched from the database on next access.
 * Suspended/cancelled firms are written to a NEGATIVE cache (shorter TTL:
 * NEGATIVE_CACHE_TTL_MS, default 10 s) to prevent DB CPU exhaustion on
 * repeated requests to those slugs.
 * Call `clearTenantCache(slug?)` to invalidate one or all entries — useful
 * after a firm's tier/status changes.
 *
 * @extendingAuthMethods
 * The resolution chain is an ordered sequence of named resolvers. To add a
 * new auth method (e.g. API-key header):
 *   1. Create a resolver function matching the signature:
 *      `(request: FastifyRequest) => Promise<ResolvedTenant | null>`
 *   2. Insert it in `RESOLVERS` before the subdomain resolver.
 *   3. The first non-null return wins; subsequent resolvers are skipped.
 *
 * @dependency @fastify/jwt
 * This plugin calls `request.jwtVerify()` which requires @fastify/jwt to be
 * registered on the same Fastify instance before this plugin is loaded.
 * Registration order in server.ts must be:
 *   cors → helmet → rateLimit → jwt → tenant
 *
 * @withTenantSchema — BREAKING CHANGE (C2 fix, 2026-04-29)
 * The queryFn now receives a postgres.js transaction object as its first
 * argument. All queries inside queryFn MUST use that `tx`, not the outer
 * pool, to guarantee they execute on the connection where SET LOCAL is active.
 *
 * Migration:
 *   // Before (broken — queries silently ran on outer pool):
 *   withTenantSchema(request, () => pool`SELECT * FROM matters`)
 *
 *   // After (correct):
 *   withTenantSchema(request, (tx) => tx`SELECT * FROM matters`)
 *
 * Current callers: none as of Day 2. Flag this comment for removal once the
 * first caller lands.
 */

import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '@themisos/db';
import { getFirmSchemaName, FIRM_SCHEMA_REGEX } from '@themisos/db';
import { JwtPayloadSchema } from '@themisos/types';
import type { FirmRole, SubscriptionTier } from '@themisos/types';
import type postgres from 'postgres';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Resolved tenant context attached to every non-exempt request.
 * Null on exempt routes (health, auth, public).
 */
export interface FirmContext {
  /** UUID of the firm (from public.firms.id) */
  firmId: string;
  /** URL-safe slug, e.g. "acme-legal" */
  firmSlug: string;
  /** Postgres schema name, e.g. "firm_acme_legal" */
  schemaName: string;
  /** UUID of the authenticated user; null on header/subdomain-only resolution */
  userId: string | null;
  /** Role within the firm; null when resolved without JWT */
  userRole: FirmRole | null;
  /** Active subscription tier */
  tier: SubscriptionTier;
}

/** Lightweight shape returned from the DB lookup */
interface FirmRow {
  id: string;
  slug: string;
  schema_name: string;
  tier: SubscriptionTier;
  status: string;
}

/** Positive cache entry with TTL timestamp */
interface CacheEntry {
  firmRow: FirmRow;
  cachedAt: number;
}

/** Negative cache entry — records a suspended/cancelled state to short-circuit DB lookups */
interface NegativeCacheEntry {
  code: 'FIRM_SUSPENDED' | 'FIRM_CANCELLED';
  cachedAt: number;
}

/** Partial tenant data returned by a resolver before user info is merged */
interface ResolvedTenant {
  firmRow: FirmRow;
  userId: string | null;
  userRole: FirmRole | null;
}

// The postgres.js transaction type — used in withTenantSchema callback signature.
type TxSql = postgres.Sql<{}>;

// ---------------------------------------------------------------------------
// Fastify type augmentation
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Resolved tenant context.
     * Null on exempt routes (health / auth / public).
     * Always populated on all other routes — plugin returns 401 if unresolvable.
     */
    firmContext: FirmContext | null;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Positive cache TTL in milliseconds.
 * Override via TENANT_CACHE_TTL_MS env var for ops tuning without redeploy.
 */
const CACHE_TTL_MS = parseInt(process.env['TENANT_CACHE_TTL_MS'] ?? '60000', 10);

/**
 * Negative cache TTL for suspended/cancelled firms.
 * Shorter than positive TTL to limit exposure window while preventing
 * repeated DB hits on malicious slug-hammering.
 */
const NEGATIVE_CACHE_TTL_MS = parseInt(process.env['TENANT_NEGATIVE_CACHE_TTL_MS'] ?? '10000', 10);

const PRODUCT_DOMAIN = process.env['PRODUCT_DOMAIN'] ?? 'themisos.gr';

/**
 * Routes that do not require tenant context — exact matches and prefix
 * matches (suffix `*`) are both supported.
 *
 * NOTE: /api/v1/auth/verify-email and /api/v1/auth/reset-password are handled
 * separately via startsWith() in isExemptRoute() because they carry a dynamic
 * token path segment (:token) that cannot be matched with a single exact entry.
 */
const EXEMPT_ROUTES: ReadonlyArray<string> = [
  '/health',
  '/healthz',
  '/readyz',
  '/metrics',
  '/api/v1/auth/login',
  '/api/v1/auth/register-firm',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/refresh',
  '/api/v1/public/*',
];

/**
 * Path prefixes exempt via startsWith() — for routes with dynamic segments.
 * Added separately from EXEMPT_ROUTES to keep intent explicit.
 */
const EXEMPT_PREFIXES: ReadonlyArray<string> = [
  '/api/v1/auth/verify-email',
  '/api/v1/auth/reset-password',
];

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

/** Module-level positive cache — survives across requests within the same process */
const firmCache = new Map<string, CacheEntry>();

/**
 * Module-level negative cache — records suspended/cancelled slugs.
 * Prevents DB CPU exhaustion from repeated requests to inactive firm slugs.
 */
const negativeFirmCache = new Map<string, NegativeCacheEntry>();

/**
 * Clears the in-memory tenant cache (both positive and negative).
 *
 * @param slug - If provided, clears only that firm's entry.
 *               If omitted, clears the entire cache.
 *
 * @example
 * // After updating a firm's tier:
 * clearTenantCache('acme-legal');
 *
 * // After a mass suspension event:
 * clearTenantCache();
 */
export function clearTenantCache(slug?: string): void {
  if (slug !== undefined) {
    firmCache.delete(slug);
    negativeFirmCache.delete(slug);
  } else {
    firmCache.clear();
    negativeFirmCache.clear();
  }
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

/** Returns a cached FirmRow if present and not expired. */
function getCached(slug: string): FirmRow | null {
  const entry = firmCache.get(slug);
  if (entry === undefined) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    firmCache.delete(slug);
    return null;
  }
  return entry.firmRow;
}

/** Stores a FirmRow in the positive cache with the current timestamp. */
function setCached(slug: string, firmRow: FirmRow): void {
  firmCache.set(slug, { firmRow, cachedAt: Date.now() });
}

/** Returns the negative cache entry for a slug if present and not expired. */
function getNegativeCached(slug: string): NegativeCacheEntry | null {
  const entry = negativeFirmCache.get(slug);
  if (entry === undefined) return null;
  if (Date.now() - entry.cachedAt > NEGATIVE_CACHE_TTL_MS) {
    negativeFirmCache.delete(slug);
    return null;
  }
  return entry;
}

/** Stores a negative (suspended/cancelled) result in the negative cache. */
function setNegativeCached(slug: string, code: NegativeCacheEntry['code']): void {
  negativeFirmCache.set(slug, { code, cachedAt: Date.now() });
}

// ---------------------------------------------------------------------------
// DB lookup
// ---------------------------------------------------------------------------

/**
 * Fetches firm metadata from public.firms by slug.
 * Sends a 403 response and returns null for suspended or cancelled firms.
 * Returns null when no matching firm is found (triggers 401 upstream).
 *
 * Suspended/cancelled results are written to the negative cache (10 s TTL)
 * to prevent DB CPU exhaustion from repeated requests to inactive slugs.
 *
 * @param slug - The firm slug to look up.
 * @param reply - Fastify reply used to send 403 responses.
 */
async function lookupFirmBySlug(
  slug: string,
  reply: FastifyReply
): Promise<FirmRow | null> {
  // Check positive cache first
  const cached = getCached(slug);
  if (cached !== null) return cached;

  // Check negative cache — avoids DB hit for known suspended/cancelled slugs
  const negCached = getNegativeCached(slug);
  if (negCached !== null) {
    if (negCached.code === 'FIRM_SUSPENDED') {
      await reply.code(403).send({
        error: {
          code: 'FIRM_SUSPENDED',
          message: 'Ο λογαριασμός του γραφείου έχει ανασταλεί. Επικοινωνήστε με την υποστήριξη.',
          requestId: reply.request.id,
        },
      });
    } else {
      await reply.code(403).send({
        error: {
          code: 'FIRM_CANCELLED',
          message: 'Ο λογαριασμός του γραφείου έχει ακυρωθεί.',
          requestId: reply.request.id,
        },
      });
    }
    return null;
  }

  const rows = await pool<FirmRow[]>`
    SELECT id, slug, schema_name, status, tier
    FROM public.firms
    WHERE slug = ${slug}
    LIMIT 1
  `;

  const row = rows[0];
  if (row === undefined) return null;

  if (row.status === 'suspended') {
    // Cache the suspended state to prevent DB CPU exhaustion attack
    setNegativeCached(slug, 'FIRM_SUSPENDED');
    await reply.code(403).send({
      error: {
        code: 'FIRM_SUSPENDED',
        message: 'Ο λογαριασμός του γραφείου έχει ανασταλεί. Επικοινωνήστε με την υποστήριξη.',
        requestId: reply.request.id,
      },
    });
    return null;
  }

  if (row.status === 'cancelled') {
    // Cache the cancelled state to prevent DB CPU exhaustion attack
    setNegativeCached(slug, 'FIRM_CANCELLED');
    await reply.code(403).send({
      error: {
        code: 'FIRM_CANCELLED',
        message: 'Ο λογαριασμός του γραφείου έχει ακυρωθεί.',
        requestId: reply.request.id,
      },
    });
    return null;
  }

  // Only trial and active firms proceed
  if (row.status !== 'trial' && row.status !== 'active') {
    return null;
  }

  setCached(slug, row);
  return row;
}

// ---------------------------------------------------------------------------
// Route exemption check
// ---------------------------------------------------------------------------

/**
 * Returns true if the given URL path is exempt from tenant resolution.
 *
 * Three matching strategies:
 *   1. Exact match against EXEMPT_ROUTES entries without `*`.
 *   2. Prefix match against EXEMPT_ROUTES entries ending with `*`.
 *   3. startsWith() match against EXEMPT_PREFIXES for routes with dynamic
 *      segments (e.g. /api/v1/auth/verify-email/:token).
 *
 * @param path - The raw request URL path (e.g. "/api/v1/auth/login").
 */
function isExemptRoute(path: string): boolean {
  for (const pattern of EXEMPT_ROUTES) {
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (path.startsWith(prefix)) return true;
    } else {
      if (path === pattern) return true;
    }
  }

  for (const prefix of EXEMPT_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

/**
 * Resolver A: JWT in Authorization header.
 * Decodes and verifies the Bearer token via @fastify/jwt.
 * Extracts firm_slug, user id, and role from the payload.
 *
 * @throws 401 INVALID_TOKEN if the token is malformed.
 * @throws 401 TOKEN_EXPIRED if the token has expired.
 */
async function resolveFromJwt(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<ResolvedTenant | null> {
  const authHeader = request.headers['authorization'];
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.jwtVerify();
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };
    const isExpired =
      error.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED' ||
      (typeof error.message === 'string' && error.message.includes('expired'));

    await reply.code(401).send({
      error: {
        code: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
        message: isExpired
          ? 'Η συνεδρία σας έχει λήξει. Παρακαλώ συνδεθείτε ξανά.'
          : 'Μη έγκυρο token αυθεντικοποίησης.',
        requestId: request.id,
      },
    });
    return null;
  }

  const parsed = JwtPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    await reply.code(401).send({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Το token δεν περιέχει τα απαραίτητα στοιχεία.',
        requestId: request.id,
      },
    });
    return null;
  }

  const payload = parsed.data;
  const firmRow = await lookupFirmBySlug(payload.firm_slug, reply);
  if (firmRow === null) return null;

  return {
    firmRow,
    userId: payload.sub,
    userRole: payload.role,
  };
}

/**
 * Resolver B: x-firm-slug header (B2B API token auth, future use).
 * Looks up the firm by slug without attaching a user identity.
 * User identity will be resolved separately once API token auth is implemented.
 *
 * @note userId and userRole are null until API token → user mapping is added.
 */
async function resolveFromHeader(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<ResolvedTenant | null> {
  const slugHeader = request.headers['x-firm-slug'];
  if (typeof slugHeader !== 'string' || slugHeader.length === 0) {
    return null;
  }

  const firmRow = await lookupFirmBySlug(slugHeader, reply);
  if (firmRow === null) return null;

  return { firmRow, userId: null, userRole: null };
}

/**
 * Resolver C: subdomain from request.hostname.
 * Matches `<slug>.<PRODUCT_DOMAIN>` and resolves the firm by slug.
 *
 * @note userId and userRole are null — subdomain alone does not authenticate a user.
 */
async function resolveFromSubdomain(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<ResolvedTenant | null> {
  const hostname = request.hostname ?? '';

  if (!hostname.endsWith(`.${PRODUCT_DOMAIN}`)) return null;

  const slug = hostname.slice(0, -(PRODUCT_DOMAIN.length + 1));
  if (slug.length === 0) return null;

  const firmRow = await lookupFirmBySlug(slug, reply);
  if (firmRow === null) return null;

  return { firmRow, userId: null, userRole: null };
}

// ---------------------------------------------------------------------------
// withTenantSchema helper
// ---------------------------------------------------------------------------

/**
 * Wraps a query function inside a transaction with `SET LOCAL search_path`
 * scoped to the current request's firm schema.
 *
 * This ensures all unqualified table references resolve to the correct tenant
 * schema for the duration of the transaction.
 *
 * **BREAKING CHANGE (C2 fix, 2026-04-29):**
 * `queryFn` now receives the postgres.js transaction object (`tx`) as its
 * only argument. All queries inside `queryFn` MUST use `tx` — using the outer
 * `pool` directly will bypass the SET LOCAL and break tenant isolation.
 *
 * Current callers: none as of Day 2 (this function is not yet called from any
 * route handler). Remove this notice once the first caller is merged and
 * verified against the integration test described in day2-daedalus-review.md §C2.
 *
 * @remarks
 * **Drizzle integration (next sprint):** Pass a Drizzle transaction client
 * obtained from `db.transaction()` into `queryFn`. Today the helper uses the
 * raw postgres.js pool directly. When the Drizzle layer is wired, replace
 * `pool.begin(...)` with `db.transaction(tx => queryFn(tx))` and issue
 * `SET LOCAL search_path` via `tx.execute(sql\`SET LOCAL ...\`)`.
 *
 * @param request - The Fastify request with a resolved firmContext.
 * @param queryFn - Async function that runs inside the transaction.
 *                  Receives the transaction connection as its argument.
 *                  MUST use `tx` for all queries, not the outer pool.
 * @returns The value returned by queryFn.
 * @throws Error if firmContext is null (should never happen on non-exempt routes).
 * @throws Error if schemaName fails the FIRM_SCHEMA_REGEX whitelist (defense-in-depth).
 *
 * @example
 * ```ts
 * const cases = await withTenantSchema(request, async (tx) => {
 *   return tx<CaseRow[]>`SELECT * FROM cases ORDER BY created_at DESC LIMIT 20`;
 * });
 * ```
 */
export async function withTenantSchema<T>(
  request: FastifyRequest,
  queryFn: (tx: TxSql) => Promise<T>
): Promise<T> {
  const ctx = request.firmContext;
  if (ctx === null) {
    throw new Error('withTenantSchema: firmContext is null — called on an exempt route?');
  }

  const { schemaName } = ctx;

  // Defense in depth: re-validate even though the plugin already did at resolution time.
  // Uses the canonical FIRM_SCHEMA_REGEX imported from @themisos/db (M7 fix).
  if (!FIRM_SCHEMA_REGEX.test(schemaName)) {
    throw new Error(`withTenantSchema: invalid schema name: ${schemaName}`);
  }

  return pool.begin(async (tx) => {
    // schemaName is whitelisted by FIRM_SCHEMA_REGEX above; unsafe() is safe here.
    // SET LOCAL scopes the search_path to this transaction only; it resets on commit/rollback.
    await (tx as unknown as TxSql).unsafe(
      `SET LOCAL search_path TO "${schemaName}", tenant_template, public`
    );
    // CRITICAL: pass tx into queryFn so all queries run on the same connection.
    return queryFn(tx as unknown as TxSql);
  }) as Promise<T>;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const tenantPlugin: FastifyPluginAsync = async (fastify) => {
  // Decorate every request with firmContext = null (overwritten in hook below)
  fastify.decorateRequest('firmContext', null);

  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Strip query string for route matching
    const path = request.url.split('?')[0] ?? request.url;

    // Exempt routes — set null and pass through
    if (isExemptRoute(path)) {
      request.firmContext = null;
      return;
    }

    // Resolution chain — first non-null result wins
    const resolvers = [resolveFromJwt, resolveFromHeader, resolveFromSubdomain];

    let resolved: ResolvedTenant | null = null;

    for (const resolver of resolvers) {
      // If reply was already sent (e.g. 403 from lookupFirmBySlug), stop
      if (reply.sent) return;

      resolved = await resolver(request, reply);
      if (resolved !== null) break;
    }

    if (reply.sent) return;

    if (resolved === null) {
      await reply.code(401).send({
        error: {
          code: 'TENANT_REQUIRED',
          message: 'Δεν ήταν δυνατός ο προσδιορισμός του γραφείου. Παρακαλώ συνδεθείτε.',
          requestId: request.id,
        },
      });
      return;
    }

    const { firmRow, userId, userRole } = resolved;

    request.firmContext = {
      firmId: firmRow.id,
      firmSlug: firmRow.slug,
      schemaName: getFirmSchemaName(firmRow.slug),
      userId,
      userRole,
      tier: firmRow.tier,
    };

    request.log.info(
      { firmId: firmRow.id, firmSlug: firmRow.slug, userId },
      'tenant resolved'
    );
  });
};

export default fp(tenantPlugin, {
  name: 'tenant',
  // This plugin requires @fastify/jwt to be registered first.
  // Ensure server.ts registers jwt before tenant.
  dependencies: ['@fastify/jwt'],
});
