# Day 4 Auth Notes — ΘΕΜΙΣ OS

## Why JWT in cookie vs localStorage

**Decision: httpOnly cookie (`themisos_session`)**

Reason: XSS protection. localStorage is accessible to any JavaScript running on the page, including injected scripts. An httpOnly cookie cannot be read by `document.cookie` or any client-side JS, so a successful XSS attack cannot exfiltrate the session token.

Trade-offs accepted:
- CSRF risk: mitigated by `SameSite=Lax` (protects against cross-site form submissions and link navigations that trigger state changes; allows GET navigations which we don't expose as state-mutating). Phase 2 adds `SameSite=Strict` once subdomain trust is established.
- No mobile app / React Native support from Day 1. Phase 2: add a separate `Authorization: Bearer` flow for native clients (already scaffolded in the tenant plugin).

Cookie attributes:
```
Set-Cookie: themisos_session=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800
```

JWT lifetime: 8 hours (28800s). Chosen to cover a full working day without mid-day re-auth for active users, while limiting the exposure window from credential theft.

## Session Revocation Strategy

**Phase 1 (Day 4):** Database-backed jti blocklist per tenant schema.

On logout or security event:
1. `UPDATE user_sessions SET revoked_at = NOW() WHERE jwt_jti = ?`
2. `GET /api/v1/auth/me` checks `SELECT revoked_at FROM user_sessions WHERE jwt_jti = ?` on every call.

Trade-off: `/me` has a DB lookup on every call. For Phase 1 (small user base, low traffic) this is acceptable. Reads hit a tight index on `jwt_jti`.

**Phase 2 (Day 5): Redis jti blocklist**

- On logout: `SET revoked:<jti> 1 EX <remaining_ttl_seconds>` in Redis
- On every authenticated request: `EXISTS revoked:<jti>` — microsecond lookup, no DB
- Eliminates the per-request DB roundtrip for session validation
- Survives Fastify restarts (Redis is durable)
- TTL = remaining JWT lifetime → automatic cleanup, no cron needed

Architecture in Day 5:
```
verify JWT signature (jose/fastify-jwt)
  → if valid: EXISTS Redis "revoked:<jti>"
    → 0: proceed
    → 1: return 401 SESSION_REVOKED
```

The `user_sessions` table remains the source of truth for audit and compliance reporting. Redis is purely a performance cache of the revoked set.

## MFA Strategy for Phase 2

**TOTP (RFC 6238) + backup codes**

1. Enrollment:
   - Generate 20-byte base32 secret (python-secrets compatible)
   - Encrypt with firm DEK: `pgp_sym_encrypt(secret, firm_dek)` → stored in `public.firm_users.mfa_secret`
   - Return QR code (otpauth:// URI) + 8 backup codes (one-time use, sha256-hashed in `firm_<slug>.mfa_backup_codes`)
   - Require user to confirm with first TOTP code before enabling

2. Login flow with MFA enabled:
   - Phase 1 POST /login returns `{ requiresMfa: true, mfaToken: <short-lived-jwt> }` (30s TTL, scoped to MFA step only)
   - Phase 2 POST /auth/mfa/verify body: `{ mfaToken, totp }` → verify, issue full session JWT
   - Backup code flow: POST /auth/mfa/backup-code body: `{ mfaToken, backupCode }` → mark code used

3. Recovery:
   - Admin can disable MFA for a user (requires 2FA by admin + audit log entry)
   - Users with no backup codes → support contact required (no self-service to prevent social engineering)

4. Session token: `mfa_verified: true` added to JWT payload on completion

5. Brute-force protection: 5 failed TOTP attempts → lock MFA for 15 minutes (stored in `user_sessions` or Redis counter in Phase 2)

## Password Reset Email Template (Resend)

Template for Resend integration (stub in `forgot-password` route handler):

```ts
// TODO: Replace stub comment in apps/api/src/routes/auth/index.ts ~line 340
import { Resend } from 'resend';

const resend = new Resend(process.env['RESEND_API_KEY']);

await resend.emails.send({
  from: `ΘΕΜΙΣ OS <noreply@${PRODUCT_DOMAIN}>`,
  to: userEmail,  // user email resolved internally — never from request body
  subject: 'Επαναφορά κωδικού πρόσβασης',
  replyTo: process.env['EMAIL_REPLY_TO'] ?? `support@${PRODUCT_DOMAIN}`,
  html: `
    <div style="font-family: sans-serif; max-width: 560px; margin: auto;">
      <h2 style="color: #1e3a5f;">Επαναφορά κωδικού πρόσβασης</h2>
      <p>Λάβαμε αίτημα επαναφοράς κωδικού για τον λογαριασμό σας στο ΘΕΜΙΣ OS.</p>
      <p>
        <a href="https://${firmSlug}.${PRODUCT_DOMAIN}/reset-password?token=${rawToken}&firm=${firmSlug}"
           style="display: inline-block; padding: 12px 24px; background: #1d4ed8; color: white;
                  border-radius: 8px; text-decoration: none; font-weight: 600;">
          Επαναφορά κωδικού
        </a>
      </p>
      <p style="color: #6b7280; font-size: 13px;">
        Ο σύνδεσμος λήγει σε 1 ώρα. Αν δεν ζητήσατε επαναφορά, αγνοήστε αυτό το email.
      </p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="color: #9ca3af; font-size: 12px;">
        ΘΕΜΙΣ OS — Λογισμικό Διαχείρισης Δικηγορικού Γραφείου<br />
        Αίτημα από IP: ${ip}
      </p>
    </div>
  `,
});
```

Security notes:
- `rawToken` is the 64-char hex string — included only in the email link, never in logs
- `ip` is logged in the `password_reset_tokens` table for forensics
- Template uses inline CSS (Resend renders in email clients that strip `<style>` tags)
- `replyTo` set to support address so users can reply for help

## Required Package Dependencies

The following packages are referenced in Day 4 code but not yet in package.json:

| Package | Where | Already Present |
|---------|-------|-----------------|
| `argon2` | `apps/api` — password hashing | NO — add to deps |
| `jose` | `apps/web` — JWT verification | NO — add to deps |
| `fastify-plugin` | `apps/api` — route plugin wrapping | Check — likely transitive |
| `react-hook-form` | `apps/web` | YES (package.json line 24) |
| `@hookform/resolvers` | `apps/web` | YES (package.json line 26) |
| `@fastify/rate-limit` | `apps/api` | YES (package.json line 19) |
| `@fastify/jwt` | `apps/api` | YES (package.json line 22) |
| `@fastify/cookie` | `apps/api` | YES (package.json line 23) |

### To add (flag for Δαίδαλος):
```bash
# apps/api
pnpm add argon2

# apps/web
pnpm add jose
```

## Open Questions for Δαίδαλος

1. **provisionFirm tenant DDL**: The `register-firm` route creates the schema and sets `search_path` but does NOT clone the full `0002_template_schema.sql` DDL. Day 4 assumes the Day 3 provisioning script handles this. The route should enqueue a BullMQ job (`provision-firm` queue) instead of doing it inline. Wire this before production.

2. **fastify-plugin**: `fp` from `fastify-plugin` is used in the auth routes file. Check if it is a direct dependency of `@themisos/api` — it may come only as a transitive dep of `@fastify/*`. Add explicitly if not.

3. **audit_log INSERT**: The audit_log table is partitioned by `occurred_at`. The INSERT in the login/logout/reset routes does not specify `occurred_at`, relying on `DEFAULT now()`. Confirm that Postgres inserts into the correct partition automatically (it does for declarative partitioning with DEFAULT = now()).

4. **Rate limit per email**: The task spec requires rate limiting by IP+email on login (not just IP). `@fastify/rate-limit` keys by IP by default. To key by IP+email, set `keyGenerator` in the route config. This is NOT implemented in Day 4 (would require reading the body before rate-limit middleware runs, which is a Fastify ordering issue). Implement in Day 5 with Redis-backed custom keyGenerator.

5. **Forgot-password rate limit per email**: Same issue — current implementation rate-limits by IP only. Correct implementation needs custom `keyGenerator` reading the body email field.

6. **jose import in middleware.ts**: `middleware.ts` imports from `./lib/jwt-verify` which uses `jose`. Next.js middleware runs in the Edge Runtime, which does not support all Node.js APIs. `jose` is Edge-compatible, but verify this during build. If issues arise, use `next/headers` + Server Components approach instead of middleware-level JWT verification.

7. **`cookies()` async API**: Next.js 15 made `cookies()` async (returns a Promise). The auth.ts helpers await it correctly. Confirm this matches the exact Next.js 15.4.0 API — check if `await cookies()` is the correct form or if it's still synchronous in 15.4.

8. **`user_sessions.id` type**: The template schema defines `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`. The login route inserts `jti` (a UUID string from `crypto.randomUUID()`) as both the `id` and `jwt_jti` columns. This means `id = jti = jwt_jti` — verify this is intentional or if `id` should be a separate auto-generated UUID.
