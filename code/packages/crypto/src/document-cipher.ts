// @themisos/crypto — High-level document encryption helpers
// Used before Cloudflare R2 upload and after R2 download.
// Spec ref: docs/v03/tech-stack-v03.md §17.2, §5 (Storage)
// Invariant #9: 'public' = no encryption; 'confidential' = MECE KMS envelope;
//               'privileged' = customer KMS (BYOK, Phase 2 stub).
//
// The `envelope_metadata` JSONB column in tenant_template.document stores
// a serialisable representation of EnvelopeEncrypted (see 0004 migration).
// `ciphertext` itself is NOT in the JSONB — it is the R2 object content.

import { envelopeEncrypt, envelopeDecrypt } from './envelope';
import type { EnvelopeEncrypted, AuditContext } from './envelope';

// ---------------------------------------------------------------------------
// Serialisable envelope (suitable for JSONB storage in Postgres)
// The Buffer fields are stored as base64 strings because JSONB cannot hold
// raw binary. Deserialisation back to Buffer happens in fromJsonEnvelope().
// ---------------------------------------------------------------------------

export interface JsonEnvelope {
  ciphertextB64: string;   // always empty string — ciphertext lives in R2, not here
  ivB64: string;
  authTagB64: string;
  encryptedDekB64: string;
  kekVaultPath: string;
  kekVersion: number;
  algorithm: 'AES-256-GCM';
  encryptedAt: string;
}

// ---------------------------------------------------------------------------
// toJsonEnvelope / fromJsonEnvelope — Buffer ↔ base64 serialisation
// ---------------------------------------------------------------------------

export function toJsonEnvelope(envelope: EnvelopeEncrypted): JsonEnvelope {
  return {
    ciphertextB64: '',                               // ciphertext is stored in R2
    ivB64: envelope.iv.toString('base64'),
    authTagB64: envelope.authTag.toString('base64'),
    encryptedDekB64: envelope.encryptedDek.toString('base64'),
    kekVaultPath: envelope.kekVaultPath,
    kekVersion: envelope.kekVersion,
    algorithm: envelope.algorithm,
    encryptedAt: envelope.encryptedAt,
  };
}

export function fromJsonEnvelope(
  json: JsonEnvelope,
  r2Ciphertext: Buffer
): EnvelopeEncrypted {
  return {
    ciphertext: r2Ciphertext,
    iv: Buffer.from(json.ivB64, 'base64'),
    authTag: Buffer.from(json.authTagB64, 'base64'),
    encryptedDek: Buffer.from(json.encryptedDekB64, 'base64'),
    kekVaultPath: json.kekVaultPath,
    kekVersion: json.kekVersion,
    algorithm: json.algorithm,
    encryptedAt: json.encryptedAt,
  };
}

// ---------------------------------------------------------------------------
// encryptDocumentForR2
//
// Returns:
//   ciphertext   — the bytes to upload to R2 (encrypted or plaintext)
//   envelope     — JSONB to store in document.envelope_metadata (null if public)
//   storageMode  — matches the storage_mode_t enum in the DB
// ---------------------------------------------------------------------------

export async function encryptDocumentForR2(
  plaintext: Buffer,
  firmSlug: string,
  classification: 'public' | 'confidential' | 'privileged'
): Promise<{
  ciphertext: Buffer;
  envelope: JsonEnvelope | null;
  storageMode: 'plain' | 'envelope';
}> {
  if (classification === 'public') {
    // Public documents are stored as-is in R2.
    // R2 server-side encryption (SSE) applies at rest by Cloudflare.
    return {
      ciphertext: plaintext,
      envelope: null,
      storageMode: 'plain',
    };
  }

  // 'confidential' and 'privileged' both use envelope encryption.
  // For 'privileged' in Phase 1, envelopeEncrypt() will throw
  // PrivilegeKeyNotConfiguredError — this propagates to the caller.
  const encResult = await envelopeEncrypt(
    plaintext,
    firmSlug,
    classification
  );

  return {
    ciphertext: encResult.ciphertext,
    envelope: toJsonEnvelope(encResult),
    storageMode: 'envelope',
  };
}

// ---------------------------------------------------------------------------
// decryptDocumentFromR2
//
// r2Ciphertext — raw bytes downloaded from R2
// jsonEnvelope — deserialized from document.envelope_metadata JSONB
//                (null if classification='public')
// auditContext — required for privileged documents to satisfy Invariant #9
// sql          — postgres.js connection with firm search_path set
//                (required when classification='privileged' for audit insert)
// ---------------------------------------------------------------------------

type SqlExec = (
  template: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>;

export async function decryptDocumentFromR2(
  r2Ciphertext: Buffer,
  jsonEnvelope: JsonEnvelope | null,
  firmSlug: string,
  classification: 'public' | 'confidential' | 'privileged',
  auditContext?: AuditContext,
  sql?: SqlExec
): Promise<Buffer> {
  if (classification === 'public') {
    // No encryption applied — return bytes as-is.
    return r2Ciphertext;
  }

  if (jsonEnvelope === null) {
    throw new Error(
      `document.envelope_metadata is null but classification="${classification}". ` +
        'Data integrity error: envelope_metadata must be present for non-public documents.'
    );
  }

  const envelope = fromJsonEnvelope(jsonEnvelope, r2Ciphertext);

  return envelopeDecrypt(envelope, firmSlug, classification, {
    ...(auditContext !== undefined && { auditContext }),
    ...(sql !== undefined && { sql }),
  });
}
