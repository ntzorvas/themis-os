// @themisos/crypto — Barrel exports
// Public surface area for the encryption package.
// Internal helpers (wrapVaultError, etc.) are NOT exported.

// Vault client
export { VaultClient, vault } from './vault-client.js';
export type { VaultConfig } from './vault-client.js';

// Envelope encryption
export { envelopeEncrypt, envelopeDecrypt } from './envelope.js';
export type { EnvelopeEncrypted, AuditContext } from './envelope.js';

// Document-level helpers (R2 upload/download)
export {
  encryptDocumentForR2,
  decryptDocumentFromR2,
  toJsonEnvelope,
  fromJsonEnvelope,
} from './document-cipher.js';
export type { JsonEnvelope } from './document-cipher.js';

// Firm provisioning
export { provisionFirmKeys } from './firm-provisioning-hook.js';

// Typed errors
export {
  CryptoBaseError,
  PrivilegeKeyNotConfiguredError,
  VaultSealedError,
  VaultConnectionError,
  VaultOperationError,
  AuditFailureError,
  DekVersionNotFoundError,
} from './errors.js';
