// @themisos/crypto — Barrel exports
// Public surface area for the encryption package.
// Internal helpers (wrapVaultError, etc.) are NOT exported.

// Vault client
export { VaultClient, vault } from './vault-client';
export type { VaultConfig } from './vault-client';

// Envelope encryption
export { envelopeEncrypt, envelopeDecrypt } from './envelope';
export type { EnvelopeEncrypted, AuditContext } from './envelope';

// Document-level helpers (R2 upload/download)
export {
  encryptDocumentForR2,
  decryptDocumentFromR2,
  toJsonEnvelope,
  fromJsonEnvelope,
} from './document-cipher';
export type { JsonEnvelope } from './document-cipher';

// Firm provisioning
export { provisionFirmKeys } from './firm-provisioning-hook';

// Typed errors
export {
  CryptoBaseError,
  PrivilegeKeyNotConfiguredError,
  VaultSealedError,
  VaultConnectionError,
  VaultOperationError,
  AuditFailureError,
  DekVersionNotFoundError,
} from './errors';
