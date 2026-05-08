// @themisos/crypto — Envelope encryption (AES-256-GCM)
// Spec ref: docs/v03/tech-stack-v03.md §17.2
// Invariant #9: privileged decryption FAILS CLOSED if audit INSERT fails.
//
// Envelope structure:
//   ┌─────────────────────┐
//   │  plaintext          │   (document content)
//   └─────────────────────┘
//          │  AES-256-GCM (per-call random IV, random DEK)
//          ▼
//   ┌─────────────────────┐
//   │  ciphertext         │   (stored in R2)
//   │  iv (12 bytes)      │
//   │  authTag (16 bytes) │
//   └─────────────────────┘
//
//   DEK (32 bytes, ephemeral per encrypt) → stored in Vault KV-v2 at kekVaultPath
//
// For 'confidential': KEK = MECE-managed Vault (this service).
// For 'privileged':   KEK = customer Vault path (BYOK, Phase 2).
//                     Phase 1: throws PrivilegeKeyNotConfiguredError.

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';
import { vault } from './vault-client';
import {
  PrivilegeKeyNotConfiguredError,
  AuditFailureError,
} from './errors';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EnvelopeEncrypted {
  /** AES-256-GCM ciphertext (encrypted document content). */
  ciphertext: Buffer;
  /** 12-byte random IV used for AES-256-GCM. */
  iv: Buffer;
  /** 16-byte GCM authentication tag. */
  authTag: Buffer;
  /**
   * The per-call DEK, stored encrypted in Vault at kekVaultPath.
   * In this Phase 1 design, the DEK is stored directly in Vault KV-v2
   * (Vault itself is the "wrap" boundary). This field is intentionally
   * EMPTY (zero-length Buffer) because the DEK lives in Vault, not here.
   *
   * Phase 2 upgrade: use Vault Transit to wrap the DEK with a KEK stored
   * in Vault Transit engine; store the wrapped DEK ciphertext in this field.
   * The envelope_metadata JSONB column in document then holds this blob.
   */
  encryptedDek: Buffer;
  /** Vault KV path where the unwrapped DEK is stored. */
  kekVaultPath: string;
  /** Version of the DEK at kekVaultPath. */
  kekVersion: number;
  algorithm: 'AES-256-GCM';
  /** ISO 8601 timestamp of encryption. */
  encryptedAt: string;
}

export interface AuditContext {
  userId: string;
  matterId?: string;
  documentId?: string;
  action: string;
  ip: string;
}

// ---------------------------------------------------------------------------
// DB handle type — minimal interface so we don't import @themisos/db here
// (avoiding circular deps). Callers pass a live postgres.js Sql instance.
// ---------------------------------------------------------------------------

type SqlExec = (
  template: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>;

// ---------------------------------------------------------------------------
// envelopeEncrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt plaintext using AES-256-GCM envelope encryption.
 *
 * - 'confidential': DEK generated in MECE Vault, stored under firms/<slug>/dek.
 * - 'privileged': Phase 1 stub — throws PrivilegeKeyNotConfiguredError.
 *
 * NEVER logs plaintext, DEK, or returned Buffer contents.
 */
export async function envelopeEncrypt(
  plaintext: Buffer,
  firmSlug: string,
  classification: 'confidential' | 'privileged'
): Promise<EnvelopeEncrypted> {
  if (classification === 'privileged') {
    // TODO(Phase 2): Route to customer Vault path for BYOK.
    // Customer Vault endpoint from firm settings:
    //   const customerVaultAddr = await getCustomerVaultAddr(firmSlug);
    //   const customerVaultClient = new VaultClient({ endpoint: customerVaultAddr, ... });
    //   const { dek, vaultPath, version } = await customerVaultClient.generateDEK(firmSlug, 'privilege_encryption');
    // Until Phase 2 ships, privileged encryption is not available.
    throw new PrivilegeKeyNotConfiguredError(firmSlug);
  }

  // Generate ephemeral DEK and store in MECE Vault.
  const { dek, vaultPath, version } = await vault.generateDEK(
    firmSlug,
    'data_encryption'
  );

  // 12-byte random IV — NIST SP 800-38D recommends 96-bit IV for GCM.
  const iv = randomBytes(12);

  const cipher = createCipheriv('aes-256-gcm', dek, iv) as CipherGCM;
  const ciphertextParts: Buffer[] = [];
  ciphertextParts.push(cipher.update(plaintext));
  ciphertextParts.push(cipher.final());
  const ciphertext = Buffer.concat(ciphertextParts);
  const authTag = cipher.getAuthTag();

  // DEK is now consumed. It lives only in Vault from this point.
  // Overwrite the in-memory dek buffer to reduce window of exposure.
  dek.fill(0);

  return {
    ciphertext,
    iv,
    authTag,
    encryptedDek: Buffer.alloc(0), // Phase 1: DEK stored in Vault, not here.
    kekVaultPath: vaultPath,
    kekVersion: version,
    algorithm: 'AES-256-GCM',
    encryptedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// envelopeDecrypt
// ---------------------------------------------------------------------------

/**
 * Decrypt an EnvelopeEncrypted ciphertext.
 *
 * For 'privileged' classification with auditContext provided:
 *   - Writes to audit_privilege_access BEFORE attempting decrypt.
 *   - If audit INSERT fails → throws AuditFailureError (fail-closed).
 *   - If audit INSERT succeeds → proceeds with decrypt.
 *
 * The sql parameter is required when classification='privileged'.
 * It must be a per-request postgres.js connection with search_path
 * already set to the firm's schema (firm_<slug>).
 *
 * NEVER logs the returned plaintext Buffer.
 */
export async function envelopeDecrypt(
  envelope: EnvelopeEncrypted,
  firmSlug: string,
  classification: 'confidential' | 'privileged',
  options?: {
    auditContext?: AuditContext;
    sql?: SqlExec;
  }
): Promise<Buffer> {
  if (classification === 'privileged') {
    // TODO(Phase 2): Route to customer Vault for BYOK DEK retrieval.
    // Until then, privileged decrypt is unavailable.
    throw new PrivilegeKeyNotConfiguredError(firmSlug);
  }

  // ---------------------------------------------------------------------------
  // Privilege audit gate (fail-closed)
  // For completeness, this code path is reached if classification were ever
  // non-'privileged' but still needed auditing. Currently only 'privileged'
  // triggers the audit; 'confidential' does not require an audit row.
  //
  // When Phase 2 enables privileged decrypt, move this block inside the
  // classification === 'privileged' branch above.
  // ---------------------------------------------------------------------------

  if (options?.auditContext !== undefined && options.sql !== undefined) {
    const ctx = options.auditContext;
    try {
      await options.sql`
        INSERT INTO audit_privilege_access
          (occurred_at, user_id, matter_id, document_id, action, ip, justification)
        VALUES (
          now(),
          ${ctx.userId}::uuid,
          ${ctx.matterId ?? null}::uuid,
          ${ctx.documentId ?? null}::uuid,
          ${ctx.action},
          ${ctx.ip}::inet,
          ${ctx.action}
        )
      `;
    } catch (auditErr) {
      // Fail-closed: if we cannot audit the access, we MUST NOT decrypt.
      throw new AuditFailureError(
        ctx.userId,
        ctx.documentId,
        auditErr
      );
    }
  }

  // Fetch the DEK from Vault by path + version stored in the envelope.
  // Supports old versions during rotation transition windows.
  const dek = await vault.getDEK(
    firmSlug,
    'data_encryption',
    envelope.kekVersion
  );

  const decipher = createDecipheriv(
    'aes-256-gcm',
    dek,
    envelope.iv
  ) as DecipherGCM;
  decipher.setAuthTag(envelope.authTag);

  let plaintext: Buffer;
  try {
    const parts: Buffer[] = [];
    parts.push(decipher.update(envelope.ciphertext));
    parts.push(decipher.final());
    plaintext = Buffer.concat(parts);
  } finally {
    // Overwrite DEK in memory regardless of decrypt success/failure.
    dek.fill(0);
  }

  return plaintext;
}
