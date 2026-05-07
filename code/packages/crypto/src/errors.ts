// @themisos/crypto — Typed error classes
// All crypto errors extend a base class for easy instanceof checks at API layer.
// Spec ref: docs/v03/tech-stack-v03.md §17.2, §17.4

export class CryptoBaseError extends Error {
  override readonly name: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Restores the prototype chain for instanceof checks (required when
    // compiling to ES5 targets; harmless in ES2022).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the customer has not yet configured their BYOK Vault path.
 * Phase 1 stub: privilege_encryption KEK always unavailable.
 * Phase 2: will query customer Vault endpoint instead.
 *
 * TODO(Phase 2): Replace throw with actual customer Vault lookup.
 * See docs/v03/tech-stack-v03.md §17.4 BYOK Shamir Custody.
 */
export class PrivilegeKeyNotConfiguredError extends CryptoBaseError {
  readonly firmSlug: string;

  constructor(firmSlug: string) {
    super(
      `Privilege encryption key (BYOK) is not configured for firm "${firmSlug}". ` +
        'This feature requires Enterprise tier + BYOK Sovereign Add-on (Phase 2). ' +
        'Estimated availability: 2026-Q3.'
    );
    this.firmSlug = firmSlug;
  }
}

/**
 * Thrown when Vault responds as sealed (HTTP 503 / initialized=true, sealed=true).
 * Operator must unseal Vault using Shamir key shares before retrying.
 * See docs/day5-vault-runbook.md §3 Unseal Flow.
 */
export class VaultSealedError extends CryptoBaseError {
  constructor() {
    super(
      'HashiCorp Vault is sealed. Operations requiring key material are unavailable. ' +
        'An operator must run the unseal sequence (3-of-5 Shamir shares) to restore service. ' +
        'See docs/day5-vault-runbook.md §3 for the unseal procedure.'
    );
  }
}

/**
 * Thrown when Vault is unreachable (network error, bad VAULT_ADDR, etc.).
 */
export class VaultConnectionError extends CryptoBaseError {
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super(
      'Cannot connect to HashiCorp Vault. Check VAULT_ADDR and network connectivity.'
    );
    this.cause = cause;
  }
}

/**
 * Thrown when a Vault operation returns an unexpected HTTP status.
 */
export class VaultOperationError extends CryptoBaseError {
  readonly statusCode: number | undefined;
  readonly vaultErrors: readonly string[];

  constructor(
    message: string,
    statusCode?: number,
    vaultErrors: readonly string[] = []
  ) {
    super(message);
    this.statusCode = statusCode;
    this.vaultErrors = vaultErrors;
  }
}

/**
 * Thrown when the audit INSERT into audit_privilege_access fails.
 * Per Invariant #9 "fail-closed" policy: decryption MUST NOT proceed
 * if the audit record cannot be written.
 */
export class AuditFailureError extends CryptoBaseError {
  readonly documentId: string | undefined;
  readonly userId: string;

  constructor(userId: string, documentId?: string, cause?: unknown) {
    super(
      `Failed to write audit record for privileged document access. ` +
        `userId=${userId}${documentId ? `, documentId=${documentId}` : ''}. ` +
        'Decrypt aborted (fail-closed). Fix the audit table/connection before retrying.'
    );
    this.userId = userId;
    this.documentId = documentId;
    // Attach the underlying DB error for logging (never exposed to client).
    if (cause !== undefined) {
      Object.defineProperty(this, 'auditCause', {
        enumerable: false,
        value: cause,
      });
    }
  }
}

/**
 * Thrown when the requested DEK version does not exist in Vault.
 */
export class DekVersionNotFoundError extends CryptoBaseError {
  readonly firmSlug: string;
  readonly keyType: string;
  readonly version: number;

  constructor(firmSlug: string, keyType: string, version: number) {
    super(
      `DEK version ${version} not found in Vault for firm="${firmSlug}", keyType="${keyType}".`
    );
    this.firmSlug = firmSlug;
    this.keyType = keyType;
    this.version = version;
  }
}
