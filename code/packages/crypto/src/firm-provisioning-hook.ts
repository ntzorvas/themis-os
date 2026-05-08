// @themisos/crypto — Firm provisioning hook
// Called by provisionFirm() (packages/db/src/provisioning.ts) after schema clone.
// Spec ref: docs/v03/data-model-v03.md §2.1 step 3, public.firm_kms_keys table.
//
// DEPENDENCY NOTE: Wired into provisioning.ts (Task 2, 2026-04-29).
//   import { provisionFirmKeys } from '@themisos/crypto';
//   // Call after INSERT firm_<slug>.users, inside the provisioning transaction.
//   const keys = await provisionFirmKeys(firmId, firmSlug, sql);
//
// This function uses the same postgres.js `sql` transaction object passed by
// provisionFirm() so that key metadata INSERT and schema creation are atomic.
// If Vault succeeds but the DB INSERT fails, the transaction rolls back and
// the orphaned Vault path must be cleaned up by the provisioning retry logic.

import { vault } from './vault-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Minimal postgres.js tagged-template interface.
// We avoid importing postgres directly to keep this package dependency-free
// of the DB client. The caller provides the Sql instance.
type Sql = (
  template: TemplateStringsArray,
  ...values: unknown[]
) => Promise<{ rows?: unknown[] }>;

interface ProvisionResult {
  /** Vault KV path for the data_encryption DEK. */
  dataKeyPath: string;
  /**
   * Vault KV path for the privilege_encryption DEK.
   * null in Phase 1 — BYOK not yet implemented.
   *
   * TODO(Phase 2): Generate privilege DEK from customer Vault path.
   * See docs/v03/tech-stack-v03.md §17.4 BYOK Shamir Custody.
   * Trigger: firm tier = 'enterprise' AND BYOK_SOVEREIGN_ADDON=true.
   */
  privilegeKeyPath: string | null;
}

// ---------------------------------------------------------------------------
// provisionFirmKeys
// ---------------------------------------------------------------------------

/**
 * Generates the initial DEK for a new firm and records the key metadata in
 * public.firm_kms_keys. Must be called inside the provisioning DB transaction.
 *
 * Steps:
 *   1. Generate data_encryption DEK in MECE Vault at kv/<mount>/firms/<slug>/dek
 *   2. INSERT public.firm_kms_keys (data_encryption, version 1, active)
 *   3. Privilege key: Phase 1 stub — skipped, returns null
 *
 * @param firmId   UUID of the newly-created firm (public.firms.id)
 * @param firmSlug Slug used in Vault path construction (public.firms.slug)
 * @param sql      postgres.js Sql instance with an active transaction
 */
export async function provisionFirmKeys(
  firmId: string,
  firmSlug: string,
  sql: Sql
): Promise<ProvisionResult> {
  // Step 1: Generate data encryption DEK in MECE Vault.
  // Returns vaultPath like "firms/<slug>/dek" + version 1.
  // The raw dek Buffer is discarded immediately — we only need the path.
  const { dek, vaultPath: dataKeyPath, version: dataKeyVersion } =
    await vault.generateDEK(firmSlug, 'data_encryption');

  // Overwrite ephemeral DEK — we only needed it for the Vault write.
  dek.fill(0);

  // Step 2: Insert key metadata row into public.firm_kms_keys.
  // The actual key material is NEVER stored here — only the Vault path.
  await sql`
    INSERT INTO public.firm_kms_keys
      (firm_id, key_type, vault_path, key_version, status, created_at)
    VALUES (
      ${firmId}::uuid,
      'data_encryption'::public.kms_key_type,
      ${dataKeyPath},
      ${dataKeyVersion},
      'active'::public.kms_key_status,
      now()
    )
  `;

  // Step 3: Privilege encryption key — Phase 1 stub.
  // TODO(Phase 2): Implement BYOK privilege key provisioning.
  //
  // When implemented, this should:
  //   a. Check if firm.tier === 'enterprise' AND byok_addon_enabled === true
  //   b. Accept customer Vault endpoint URL from firm settings
  //   c. Call customerVaultClient.generateDEK(firmSlug, 'privilege_encryption')
  //   d. INSERT public.firm_kms_keys with key_type='privilege_encryption'
  //   e. Send onboarding email with Shamir share instructions
  //
  // For now, privilege_encryption key is not created at provisioning time.
  // Calls to envelopeEncrypt/envelopeDecrypt with classification='privileged'
  // will throw PrivilegeKeyNotConfiguredError (expected in Phase 1).
  const privilegeKeyPath: string | null = null;

  return { dataKeyPath, privilegeKeyPath };
}
