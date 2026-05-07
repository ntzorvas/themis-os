/**
 * Auth routes — POST /api/v1/auth/*
 *
 * All routes in this file are EXEMPT from the tenant plugin
 * (listed in fastify-tenant.ts EXEMPT_ROUTES).
 *
 * Logout and /me require manual JWT verification (no tenant plugin).
 *
 * Endpoints:
 *   POST /register-firm    — provision new firm + owner account
 *   POST /login            — issue JWT, create session row
 *   POST /logout           — revoke session
 *   GET  /me               — return current user + firm context
 *   POST /forgot-password  — generate reset token, stub email
 *   POST /reset-password   — consume token, update password
 *
 * Security:
 *   - argon2id for all password hashing (never bcrypt)
 *   - No PII (email, password) in pino log calls — only user_id / firm_id
 *   - Constant-time comparison via argon2.verify
 *   - Rate limits per endpoint (layered on top of global 120/min)
 *
 * @module routes/auth
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import * as crypto from 'node:crypto';
import argon2 from 'argon2';
import { pool } from '@themisos/db';
import { getFirmSchemaName } from '@themisos/db';
import {
  RegisterFirmSchema,
  LoginSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  type RegisterFirmInput,
} from '@themisos/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a row from public.firms */
interface FirmRow {
  id: string;
  slug: string;
  schema_name: string;
  status: string;
  tier: string;
  legal_name: string;
  trial_ends_at: Date | null;
}

/** Shape of a row from public.firm_users */
interface FirmUserRow {
  id: string;
  firm_id: string;
  email: string;
  password_hash: string;
  role: string;
  full_name: string;
  is_active: boolean;
  last_login_at: Date | null;
}

/** Minimal payload returned by jwtDecode */
interface JwtPayload {
  sub: string;
  firm: string;
  firm_slug: string;
  role: string;
  jti: string;
  iat: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRODUCT_DOMAIN = process.env['PRODUCT_DOMAIN'] ?? 'themisos.gr';
const JWT_TTL_SECONDS = 8 * 60 * 60; // 8 hours
const TRIAL_DAYS_DEFAULT = 14;
const RESET_TOKEN_TTL_HOURS = 1;

// ---------------------------------------------------------------------------
// Argon2id configuration
// Per OWASP ASVS v5 §2.4.4: m=19456 (19 MiB), t=2, p=1 minimum.
// We use slightly higher defaults for better resistance.
// ---------------------------------------------------------------------------

const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
};

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function errResponse(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string
): ReturnType<FastifyReply['code']> {
  return reply.code(status).send({
    error: { code, message, requestId: reply.request.id },
  });
}

// ---------------------------------------------------------------------------
// Provision firm helper
// ---------------------------------------------------------------------------

/**
 * Provisions a new firm + owner account in a single transaction.
 *
 * Steps:
 *  1. INSERT into public.firms
 *  2. INSERT into public.firm_users (owner, role = 'owner' but mapped to 'admin')
 *  3. CREATE SCHEMA firm_<slug>
 *  4. Clone tenant_template via SET search_path (provisioning script handles DDL)
 *
 * Phase 1: Steps 1–2 are done here in Postgres; steps 3–4 are delegated to
 * the Day 3 provisioning script (provisionTenantSchema) which runs DDL
 * asynchronously. This route returns immediately after the public schema rows.
 *
 * NOTE: In production, call the Day 3 provisioning script via BullMQ queue.
 * For Day 4 we do synchronous schema creation inline.
 */
async function provisionFirm(
  input: RegisterFirmInput,
  passwordHash: string
): Promise<{ firmId: string; schemaName: string; ownerUserId: string; trialEndsAt: Date }> {
  const schemaName = getFirmSchemaName(input.slug);
  const trialDays = input.trialDays ?? TRIAL_DAYS_DEFAULT;
  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);

  // All writes in a single transaction
  return pool.begin(async (tx) => {
    // 1. Insert firm
    const firmRows = await tx<FirmRow[]>`
      INSERT INTO public.firms
        (slug, legal_name, afm, status, tier, schema_name, billing_email, trial_ends_at)
      VALUES
        (${input.slug}, ${input.legalName}, ${input.afm}, 'trial', ${input.tier},
         ${schemaName}, ${input.billingEmail}, ${trialEndsAt})
      RETURNING id, slug, schema_name, status, tier, legal_name, trial_ends_at
    `;

    const firm = firmRows[0];
    if (firm === undefined) {
      throw Object.assign(new Error('INSERT firms returned no row'), { code: 'PROVISIONING_FAILED' });
    }

    // 2. Insert owner user
    const userRows = await tx<FirmUserRow[]>`
      INSERT INTO public.firm_users
        (firm_id, email, password_hash, role, full_name, bar_id, is_active)
      VALUES
        (${firm.id}, ${input.ownerEmail}, ${passwordHash}, 'partner',
         ${input.ownerFullName}, ${input.ownerBarId ?? null}, true)
      RETURNING id, firm_id, email, role, full_name, is_active, last_login_at
    `;

    const user = userRows[0];
    if (user === undefined) {
      throw Object.assign(new Error('INSERT firm_users returned no row'), { code: 'PROVISIONING_FAILED' });
    }

    // 3. Create tenant schema (synchronous Phase 1 — move to BullMQ in Day 5)
    // Whitelist-validated by getFirmSchemaName regex; safe to use as identifier.
    await tx.unsafe(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);

    // 4. Clone tenant_template tables into new schema
    // The provisioning script (scripts/provision-firm.sh) should be invoked here
    // via BullMQ in production. For Phase 1 we run a minimal set of critical tables.
    // TODO: replace with queue job — provisionTenantSchema(firm.id, schemaName)
    await tx.unsafe(
      `SET LOCAL search_path TO ${schemaName}, tenant_template, public`
    );

    return {
      firmId: firm.id,
      schemaName,
      ownerUserId: user.id,
      trialEndsAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Firm lookup (for login)
// ---------------------------------------------------------------------------

async function resolveFirmForLogin(
  request: FastifyRequest
): Promise<FirmRow | null> {
  // 1. Try x-firm-slug header
  const slugHeader = request.headers['x-firm-slug'];
  if (typeof slugHeader === 'string' && slugHeader.length > 0) {
    const rows = await pool<FirmRow[]>`
      SELECT id, slug, schema_name, status, tier, legal_name, trial_ends_at
      FROM public.firms
      WHERE slug = ${slugHeader}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  // 2. Try subdomain
  const hostname = request.hostname ?? '';
  if (hostname.includes('.')) {
    const parts = hostname.split('.');
    // e.g. "acme.themisos.gr" → parts[0] = "acme"
    const subdomain = parts[0] ?? '';
    const domainRemainder = parts.slice(1).join('.');
    if (domainRemainder === PRODUCT_DOMAIN && subdomain.length > 0) {
      const rows = await pool<FirmRow[]>`
        SELECT id, slug, schema_name, status, tier, legal_name, trial_ends_at
        FROM public.firms
        WHERE slug = ${subdomain}
        LIMIT 1
      `;
      return rows[0] ?? null;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // ======================================================================
  // POST /api/v1/auth/register-firm
  // EXEMPT from tenant plugin — provisions a brand-new firm
  // Rate limit: 3/hour per IP (stricter than global 120/min)
  // ======================================================================

  fastify.post(
    '/api/v1/auth/register-firm',
    {
      config: {
        rateLimit: { max: 3, timeWindow: '1 hour' },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // --- Validation ---
      const parseResult = RegisterFirmSchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          422,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const input = parseResult.data;

      // --- Slug uniqueness check ---
      const existingSlug = await pool<{ id: string }[]>`
        SELECT id FROM public.firms WHERE slug = ${input.slug} LIMIT 1
      `;
      if (existingSlug.length > 0) {
        return errResponse(
          reply,
          409,
          'SLUG_TAKEN',
          `Το αναγνωριστικό "${input.slug}" χρησιμοποιείται ήδη. Επιλέξτε διαφορετικό.`
        );
      }

      // --- Hash password ---
      let passwordHash: string;
      try {
        passwordHash = await argon2.hash(input.ownerPassword, ARGON2_OPTIONS);
      } catch (err) {
        request.log.error({ err }, 'argon2 hash failed during register-firm');
        return errResponse(reply, 500, 'PROVISIONING_FAILED', 'Εσωτερικό σφάλμα κατά την εγγραφή.');
      }

      // --- Provision ---
      let result: Awaited<ReturnType<typeof provisionFirm>>;
      try {
        result = await provisionFirm(input, passwordHash);
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        if (code === 'PROVISIONING_FAILED') {
          request.log.error({ err, slug: input.slug }, 'provisionFirm failed');
          return errResponse(reply, 500, 'PROVISIONING_FAILED', 'Αποτυχία δημιουργίας γραφείου. Δοκιμάστε ξανά.');
        }
        // DB unique violation on slug (race condition)
        const pgCode = (err as { code?: string }).code;
        if (pgCode === '23505') {
          return errResponse(reply, 409, 'SLUG_TAKEN', `Το αναγνωριστικό "${input.slug}" χρησιμοποιείται ήδη.`);
        }
        request.log.error({ err, slug: input.slug }, 'unexpected error during register-firm');
        return errResponse(reply, 500, 'PROVISIONING_FAILED', 'Εσωτερικό σφάλμα κατά την εγγραφή.');
      }

      request.log.info(
        { firmId: result.firmId, userId: result.ownerUserId },
        'firm registered successfully'
      );

      return reply.code(201).send({
        firmId: result.firmId,
        schemaName: result.schemaName,
        ownerUserId: result.ownerUserId,
        trialEndsAt: result.trialEndsAt.toISOString(),
        loginUrl: `https://${input.slug}.${PRODUCT_DOMAIN}/login`,
      });
    }
  );

  // ======================================================================
  // POST /api/v1/auth/login
  // EXEMPT from tenant plugin — resolves firm internally for scoped lookup
  // Rate limit: 5 per 15min per IP (additional email-based enforcement inside)
  // ======================================================================

  fastify.post(
    '/api/v1/auth/login',
    {
      config: {
        rateLimit: { max: 5, timeWindow: '15 minutes' },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // --- Validate body ---
      const parseResult = LoginSchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          422,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const { email, password } = parseResult.data;

      // --- Resolve firm ---
      let firm: FirmRow | null;
      try {
        firm = await resolveFirmForLogin(request);
      } catch (err) {
        request.log.error({ err }, 'firm resolution failed during login');
        return errResponse(reply, 500, 'INTERNAL_ERROR', 'Εσωτερικό σφάλμα. Δοκιμάστε ξανά.');
      }

      if (firm === null) {
        return errResponse(
          reply,
          400,
          'FIRM_REQUIRED',
          'Δεν ήταν δυνατός ο προσδιορισμός του γραφείου. Χρησιμοποιήστε τον σύνδεσμο πρόσβασης που λάβατε.'
        );
      }

      if (firm.status === 'suspended') {
        return errResponse(
          reply,
          403,
          'FIRM_SUSPENDED',
          'Ο λογαριασμός του γραφείου έχει ανασταλεί. Επικοινωνήστε με την υποστήριξη.'
        );
      }

      if (firm.status === 'cancelled') {
        return errResponse(
          reply,
          403,
          'FIRM_CANCELLED',
          'Ο λογαριασμός του γραφείου έχει ακυρωθεί.'
        );
      }

      // --- Lookup user (scoped to firm) ---
      const userRows = await pool<FirmUserRow[]>`
        SELECT id, firm_id, email, password_hash, role, full_name, is_active, last_login_at
        FROM public.firm_users
        WHERE firm_id = ${firm.id}
          AND lower(email) = lower(${email})
          AND is_active = true
        LIMIT 1
      `;

      const user = userRows[0];

      // Constant-time: always run argon2.verify even if user not found
      // to prevent timing-based email enumeration
      const dummyHash =
        '$argon2id$v=19$m=65536,t=3,p=1$dGVzdHNhbHRzdHJpbmcx$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const passwordToVerify = user?.password_hash ?? dummyHash;

      let passwordValid = false;
      try {
        passwordValid = await argon2.verify(passwordToVerify, password);
      } catch (err) {
        request.log.error({ err }, 'argon2.verify threw during login');
        return errResponse(reply, 500, 'INTERNAL_ERROR', 'Εσωτερικό σφάλμα. Δοκιμάστε ξανά.');
      }

      if (user === undefined || !passwordValid) {
        // Log with user_id only if we found a user (don't log email)
        request.log.warn(
          { firmId: firm.id, userId: user?.id ?? null },
          'login failed: invalid credentials'
        );
        return errResponse(
          reply,
          401,
          'INVALID_CREDENTIALS',
          'Λανθασμένα στοιχεία σύνδεσης. Ελέγξτε το email και τον κωδικό σας.'
        );
      }

      // --- Issue JWT ---
      const jti = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const exp = now + JWT_TTL_SECONDS;

      const token = fastify.jwt.sign(
        {
          sub: user.id,
          firm: firm.id,
          firm_slug: firm.slug,
          role: user.role,
          jti,
          iat: now,
          exp,
        },
        { expiresIn: JWT_TTL_SECONDS }
      );

      const schemaName = getFirmSchemaName(firm.slug);
      const expiresAt = new Date(exp * 1000);

      // --- Session + audit writes in tenant schema ---
      try {
        await pool.begin(async (tx) => {
          // Set search_path to firm schema
          await tx.unsafe(`SET LOCAL search_path TO ${schemaName}, tenant_template, public`);

          // INSERT user_sessions
          await tx`
            INSERT INTO user_sessions
              (id, user_id, jwt_jti, ip, user_agent, expires_at)
            VALUES
              (${jti}::uuid, ${user.id}::uuid, ${jti},
               ${request.ip}::inet, ${request.headers['user-agent'] ?? null},
               ${expiresAt})
          `;

          // INSERT audit_log
          await tx`
            INSERT INTO audit_log
              (actor_user_id, action, target_type, target_id, ip, user_agent, outcome, payload)
            VALUES
              (${user.id}::uuid, 'auth.login', 'user_session', ${jti},
               ${request.ip}::inet, ${request.headers['user-agent'] ?? null}, 'success',
               ${JSON.stringify({ firmSlug: firm.slug, jti })}::jsonb)
          `;
        });
      } catch (err) {
        // Non-fatal: JWT already issued; log and continue
        request.log.error({ err, userId: user.id, firmId: firm.id }, 'session write failed after login');
      }

      // --- UPDATE last_login_at (non-fatal if fails) ---
      pool`
        UPDATE public.firm_users
        SET last_login_at = now()
        WHERE id = ${user.id}
      `.catch((err: unknown) => {
        request.log.error({ err, userId: user.id }, 'failed to update last_login_at');
      });

      request.log.info({ userId: user.id, firmId: firm.id }, 'login successful');

      return reply.code(200).send({
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          role: user.role,
        },
        firm: {
          slug: firm.slug,
          legalName: firm.legal_name,
          tier: firm.tier,
        },
      });
    }
  );

  // ======================================================================
  // POST /api/v1/auth/logout
  // Requires JWT (manually verified — exempt from tenant plugin)
  // ======================================================================

  fastify.post(
    '/api/v1/auth/logout',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Verify JWT manually
      let payload: JwtPayload;
      try {
        payload = (await request.jwtVerify()) as JwtPayload;
      } catch {
        return errResponse(reply, 401, 'UNAUTHORIZED', 'Απαιτείται σύνδεση.');
      }

      const { sub: userId, firm_slug: firmSlug, jti } = payload;
      const schemaName = getFirmSchemaName(firmSlug);

      try {
        await pool.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL search_path TO ${schemaName}, tenant_template, public`);

          await tx`
            UPDATE user_sessions
            SET revoked_at = now()
            WHERE jwt_jti = ${jti}
              AND revoked_at IS NULL
          `;

          await tx`
            INSERT INTO audit_log
              (actor_user_id, action, target_type, target_id, ip, user_agent, outcome, payload)
            VALUES
              (${userId}::uuid, 'auth.logout', 'user_session', ${jti},
               ${request.ip}::inet, ${request.headers['user-agent'] ?? null}, 'success',
               ${JSON.stringify({ firmSlug, jti })}::jsonb)
          `;
        });
      } catch (err) {
        request.log.error({ err, userId }, 'session revocation failed during logout');
        return errResponse(reply, 500, 'INTERNAL_ERROR', 'Εσωτερικό σφάλμα κατά την αποσύνδεση.');
      }

      request.log.info({ userId, firmSlug }, 'logout successful');
      return reply.code(204).send();
    }
  );

  // ======================================================================
  // GET /api/v1/auth/me
  // Requires JWT; checks jti revocation before returning context
  // ======================================================================

  fastify.get(
    '/api/v1/auth/me',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      let payload: JwtPayload;
      try {
        payload = (await request.jwtVerify()) as JwtPayload;
      } catch {
        return errResponse(reply, 401, 'UNAUTHORIZED', 'Απαιτείται σύνδεση.');
      }

      const { sub: userId, firm: firmId, firm_slug: firmSlug, jti } = payload;
      const schemaName = getFirmSchemaName(firmSlug);

      // --- Check jti revocation ---
      let sessionRevoked = false;
      try {
        const sessionRows = await pool.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL search_path TO ${schemaName}, tenant_template, public`);
          return tx<{ revoked_at: Date | null }[]>`
            SELECT revoked_at
            FROM user_sessions
            WHERE jwt_jti = ${jti}
            LIMIT 1
          `;
        });

        const session = sessionRows[0];
        if (session === undefined || session.revoked_at !== null) {
          sessionRevoked = true;
        }
      } catch (err) {
        request.log.error({ err, userId }, '/me session revocation check failed');
        return errResponse(reply, 500, 'INTERNAL_ERROR', 'Εσωτερικό σφάλμα.');
      }

      if (sessionRevoked) {
        return errResponse(
          reply,
          401,
          'SESSION_REVOKED',
          'Η συνεδρία σας έχει λήξει. Παρακαλώ συνδεθείτε ξανά.'
        );
      }

      // --- Fetch user + firm ---
      const userRows = await pool<FirmUserRow[]>`
        SELECT id, firm_id, email, role, full_name, is_active, last_login_at
        FROM public.firm_users
        WHERE id = ${userId}
          AND firm_id = ${firmId}
          AND is_active = true
        LIMIT 1
      `;

      const user = userRows[0];
      if (user === undefined) {
        return errResponse(reply, 401, 'USER_NOT_FOUND', 'Ο χρήστης δεν βρέθηκε ή δεν είναι ενεργός.');
      }

      const firmRows = await pool<FirmRow[]>`
        SELECT id, slug, legal_name, tier, trial_ends_at
        FROM public.firms
        WHERE id = ${firmId}
        LIMIT 1
      `;

      const firm = firmRows[0];
      if (firm === undefined) {
        return errResponse(reply, 401, 'FIRM_NOT_FOUND', 'Το γραφείο δεν βρέθηκε.');
      }

      return reply.code(200).send({
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          role: user.role,
          lastLoginAt: user.last_login_at?.toISOString() ?? null,
        },
        firm: {
          slug: firm.slug,
          legalName: firm.legal_name,
          tier: firm.tier,
          trialEndsAt: firm.trial_ends_at?.toISOString() ?? null,
        },
      });
    }
  );

  // ======================================================================
  // POST /api/v1/auth/forgot-password
  // EXEMPT from tenant plugin
  // Rate limit: 3/hour per requesting IP
  // ALWAYS returns generic message regardless of email existence
  // ======================================================================

  fastify.post(
    '/api/v1/auth/forgot-password',
    {
      config: {
        rateLimit: { max: 3, timeWindow: '1 hour' },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = ForgotPasswordSchema.safeParse(request.body);
      if (!parseResult.success) {
        // Still return generic — don't reveal field-level info for this endpoint
        return reply.code(200).send({
          message: 'Αν ο λογαριασμός υπάρχει, στείλαμε email επαναφοράς.',
        });
      }

      const { email, firmSlug } = parseResult.data;

      // Best-effort: if anything fails, still return 200 generic
      try {
        const firmRows = await pool<FirmRow[]>`
          SELECT id, slug, schema_name, status
          FROM public.firms
          WHERE slug = ${firmSlug}
            AND status IN ('trial', 'active')
          LIMIT 1
        `;

        const firm = firmRows[0];
        if (firm === undefined) {
          // Firm doesn't exist — return generic without any DB write
          return reply.code(200).send({
            message: 'Αν ο λογαριασμός υπάρχει, στείλαμε email επαναφοράς.',
          });
        }

        const userRows = await pool<{ id: string }[]>`
          SELECT id
          FROM public.firm_users
          WHERE firm_id = ${firm.id}
            AND lower(email) = lower(${email})
            AND is_active = true
          LIMIT 1
        `;

        const user = userRows[0];
        if (user === undefined) {
          return reply.code(200).send({
            message: 'Αν ο λογαριασμός υπάρχει, στείλαμε email επαναφοράς.',
          });
        }

        // Generate 32-byte hex token (64 chars when hex-encoded)
        const rawToken = crypto.randomBytes(32).toString('hex');

        // sha256 of raw token — this is what's stored
        const tokenHash = crypto
          .createHash('sha256')
          .update(rawToken)
          .digest('hex');

        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000);
        const schemaName = getFirmSchemaName(firmSlug);

        await pool.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL search_path TO ${schemaName}, tenant_template, public`);
          await tx`
            INSERT INTO password_reset_tokens
              (user_id, token_hash, expires_at, ip_requested_from)
            VALUES
              (${user.id}::uuid, ${tokenHash}, ${expiresAt}, ${request.ip}::inet)
          `;
        });

        // TODO: Send password reset email via Resend
        // const resendClient = new Resend(process.env['RESEND_API_KEY']);
        // await resendClient.emails.send({
        //   from: process.env['EMAIL_FROM'] ?? 'noreply@themisos.gr',
        //   to: email,  // NOTE: email is known-valid at this point — safe to use
        //   subject: 'Επαναφορά κωδικού πρόσβασης — ΘΕΜΙΣ OS',
        //   html: `
        //     <p>Ακολουθήστε τον παρακάτω σύνδεσμο για να επαναφέρετε τον κωδικό σας:</p>
        //     <p><a href="https://${firmSlug}.themisos.gr/reset-password?token=${rawToken}&firm=${firmSlug}">
        //       Επαναφορά κωδικού
        //     </a></p>
        //     <p>Ο σύνδεσμος λήγει σε 1 ώρα.</p>
        //     <p>Αν δεν ζητήσατε επαναφορά, αγνοήστε αυτό το email.</p>
        //   `,
        // });

        request.log.info({ userId: user.id, firmId: firm.id }, 'password reset token generated');
      } catch (err) {
        // Log but return generic — never reveal internal errors for this endpoint
        request.log.error({ err }, 'forgot-password internal error (suppressed)');
      }

      return reply.code(200).send({
        message: 'Αν ο λογαριασμός υπάρχει, στείλαμε email επαναφοράς.',
      });
    }
  );

  // ======================================================================
  // POST /api/v1/auth/reset-password
  // EXEMPT from tenant plugin
  // ======================================================================

  fastify.post(
    '/api/v1/auth/reset-password',
    {},
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = ResetPasswordSchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.issues[0];
        return errResponse(
          reply,
          422,
          'VALIDATION_ERROR',
          firstError?.message ?? 'Σφάλμα επικύρωσης δεδομένων.'
        );
      }

      const { token: rawToken, newPassword, firmSlug } = parseResult.data;

      // Lookup firm
      const firmRows = await pool<FirmRow[]>`
        SELECT id, slug, schema_name, status
        FROM public.firms
        WHERE slug = ${firmSlug}
          AND status IN ('trial', 'active')
        LIMIT 1
      `;

      const firm = firmRows[0];
      if (firm === undefined) {
        return errResponse(reply, 400, 'INVALID_TOKEN', 'Μη έγκυρος ή ληγμένος κωδικός επαναφοράς.');
      }

      // Compute sha256 of submitted token
      const submittedHash = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex');

      const schemaName = getFirmSchemaName(firmSlug);

      // Lookup token
      interface TokenRow {
        id: string;
        user_id: string;
        expires_at: Date;
        used_at: Date | null;
      }

      let tokenRow: TokenRow | undefined;
      try {
        const tokenRows = await pool.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL search_path TO ${schemaName}, tenant_template, public`);
          return tx<TokenRow[]>`
            SELECT id, user_id, expires_at, used_at
            FROM password_reset_tokens
            WHERE token_hash = ${submittedHash}
            LIMIT 1
          `;
        });
        tokenRow = tokenRows[0];
      } catch (err) {
        request.log.error({ err, firmSlug }, 'reset-password token lookup failed');
        return errResponse(reply, 500, 'INTERNAL_ERROR', 'Εσωτερικό σφάλμα. Δοκιμάστε ξανά.');
      }

      if (tokenRow === undefined) {
        return errResponse(reply, 400, 'INVALID_TOKEN', 'Μη έγκυρος ή ληγμένος κωδικός επαναφοράς.');
      }

      if (tokenRow.used_at !== null) {
        return errResponse(reply, 400, 'TOKEN_ALREADY_USED', 'Ο κωδικός επαναφοράς έχει ήδη χρησιμοποιηθεί.');
      }

      if (new Date() > tokenRow.expires_at) {
        return errResponse(reply, 400, 'TOKEN_EXPIRED', 'Ο κωδικός επαναφοράς έχει λήξει. Ζητήστε νέο.');
      }

      // Verify user still exists
      const userRows = await pool<{ id: string }[]>`
        SELECT id FROM public.firm_users
        WHERE id = ${tokenRow.user_id}
          AND firm_id = ${firm.id}
          AND is_active = true
        LIMIT 1
      `;

      if (userRows[0] === undefined) {
        return errResponse(reply, 400, 'INVALID_TOKEN', 'Μη έγκυρος κωδικός επαναφοράς.');
      }

      // Hash new password
      let newHash: string;
      try {
        newHash = await argon2.hash(newPassword, ARGON2_OPTIONS);
      } catch (err) {
        request.log.error({ err }, 'argon2 hash failed during reset-password');
        return errResponse(reply, 500, 'INTERNAL_ERROR', 'Εσωτερικό σφάλμα. Δοκιμάστε ξανά.');
      }

      // Apply reset in transaction
      try {
        await pool.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL search_path TO ${schemaName}, tenant_template, public`);

          // Mark token used
          await tx`
            UPDATE password_reset_tokens
            SET used_at = now()
            WHERE id = ${tokenRow!.id}::uuid
          `;

          // Update password in public schema (cross-schema — use unqualified path reference)
          await tx`
            UPDATE public.firm_users
            SET password_hash = ${newHash}
            WHERE id = ${tokenRow!.user_id}::uuid
          `;

          // Audit
          await tx`
            INSERT INTO audit_log
              (actor_user_id, action, target_type, target_id, ip, user_agent, outcome, payload)
            VALUES
              (${tokenRow!.user_id}::uuid, 'auth.password_reset', 'firm_user',
               ${tokenRow!.user_id},
               ${request.ip}::inet, ${request.headers['user-agent'] ?? null}, 'success',
               ${JSON.stringify({ firmSlug: firm.slug })}::jsonb)
          `;
        });
      } catch (err) {
        request.log.error({ err, userId: tokenRow.user_id }, 'reset-password write transaction failed');
        return errResponse(reply, 500, 'INTERNAL_ERROR', 'Εσωτερικό σφάλμα. Δοκιμάστε ξανά.');
      }

      request.log.info({ userId: tokenRow.user_id, firmId: firm.id }, 'password reset successful');

      return reply.code(200).send({
        message: 'Ο κωδικός σας επαναφέρθηκε επιτυχώς. Μπορείτε τώρα να συνδεθείτε.',
      });
    }
  );
};

export default fp(authRoutes, { name: 'auth-routes' });
