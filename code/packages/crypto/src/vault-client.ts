// @themisos/crypto — HashiCorp Vault client
// Wraps hashi-vault-js for KV-v2 operations and DEK lifecycle management.
// Spec ref: docs/v03/tech-stack-v03.md §17.1, §17.2
// Invariant #9: Key material NEVER logged, NEVER returned as plaintext to callers
//               other than in-memory Buffer returned from getDEK().

import { randomBytes } from 'node:crypto';
import Vault from 'hashi-vault-js';
import { z } from 'zod';
import {
  VaultSealedError,
  VaultConnectionError,
  VaultOperationError,
  DekVersionNotFoundError,
} from './errors';

// ---------------------------------------------------------------------------
// Config schema — validated at construction time
// ---------------------------------------------------------------------------

const VaultConfigSchema = z.object({
  endpoint: z.string().url(),
  token: z.string().min(1),
  namespace: z.string().optional(),
  kvMount: z.string().min(1).default('kv'),
});

export type VaultConfig = z.input<typeof VaultConfigSchema>;

// ---------------------------------------------------------------------------
// Internal types for Vault KV-v2 responses
// ---------------------------------------------------------------------------

interface KvReadData {
  data: {
    data: Record<string, unknown>;
    metadata: { version: number; created_time: string; destroyed: boolean };
  };
}

interface KvWriteData {
  data: { version: number };
}

interface HealthData {
  initialized: boolean;
  sealed: boolean;
}

// DEK secret stored in Vault KV-v2.
// Key: 'dek_hex' — 64-char hex representation of the 32-byte raw key.
// We store hex (not base64) for human readability in Vault UI during
// emergency recovery. The raw Buffer is reconstructed in getDEK().
// NEVER log or expose 'dek_hex' outside this module.
const DekSecretSchema = z.object({
  dek_hex: z.string().length(64).regex(/^[0-9a-f]+$/),
  created_at: z.string(),
  key_type: z.string(),
  firm_slug: z.string(),
});

// ---------------------------------------------------------------------------
// VaultClient
// ---------------------------------------------------------------------------

export class VaultClient {
  private readonly vault: InstanceType<typeof Vault>;
  private readonly kvMount: string;
  private readonly namespace: string | undefined;

  constructor(config: VaultConfig) {
    const parsed = VaultConfigSchema.parse(config);
    this.kvMount = parsed.kvMount;
    this.namespace = parsed.namespace;

    this.vault = new Vault({
      https: parsed.endpoint.startsWith('https://'),
      baseUrl: parsed.endpoint,
      rootPath: '',
      timeout: 5000,
      proxy: false,
    });
    // Set the token on the vault instance.
    // hashi-vault-js uses this for all requests.
    (this.vault as unknown as { token: string }).token = parsed.token;
  }

  // -------------------------------------------------------------------------
  // readSecret — KV-v2 read at path
  // -------------------------------------------------------------------------

  async readSecret(path: string): Promise<Record<string, unknown>> {
    try {
      // hashi-vault-js: kvReadSecret(mount, path, version?)
      const response = (await (
        this.vault as unknown as {
          kvReadSecret(
            mount: string,
            path: string,
            version?: number
          ): Promise<KvReadData>;
        }
      ).kvReadSecret(this.kvMount, path)) as KvReadData;

      return response.data.data;
    } catch (err) {
      throw this.wrapVaultError(err);
    }
  }

  // -------------------------------------------------------------------------
  // writeSecret — KV-v2 write (creates new version)
  // -------------------------------------------------------------------------

  async writeSecret(
    path: string,
    data: Record<string, unknown>
  ): Promise<{ version: number }> {
    try {
      const response = (await (
        this.vault as unknown as {
          kvCreateOrUpdateSecret(
            mount: string,
            path: string,
            data: Record<string, unknown>
          ): Promise<KvWriteData>;
        }
      ).kvCreateOrUpdateSecret(this.kvMount, path, data)) as KvWriteData;

      return { version: response.data.version };
    } catch (err) {
      throw this.wrapVaultError(err);
    }
  }

  // -------------------------------------------------------------------------
  // generateDEK — Phase 1: generate locally with crypto.randomBytes(32),
  //               store in KV-v2 as hex string.
  //
  // Phase 2 upgrade path: use Vault Transit engine `generate-data-key` endpoint
  // which generates and wraps the DEK server-side (plaintext returned once,
  // ciphertext persisted). Requires Transit mount setup in vault-runbook.md.
  //
  // Returns the raw DEK as Buffer (in-memory only) + the Vault path where
  // the wrapped copy is stored.
  // -------------------------------------------------------------------------

  async generateDEK(
    firmSlug: string,
    keyType: 'data_encryption' | 'privilege_encryption'
  ): Promise<{ dek: Buffer; vaultPath: string; version: number }> {
    // CSPRNG — never Math.random()
    const dek = randomBytes(32);
    const dekHex = dek.toString('hex');

    const pathSuffix = keyType === 'data_encryption' ? 'dek' : 'pek';
    const vaultPath = `firms/${firmSlug}/${pathSuffix}`;

    const { version } = await this.writeSecret(vaultPath, {
      dek_hex: dekHex,
      created_at: new Date().toISOString(),
      key_type: keyType,
      firm_slug: firmSlug,
    });

    // dekHex is locally scoped and goes out of scope after this function returns.
    // The dek Buffer is handed to the caller; callers must treat it as ephemeral
    // and must NOT log, persist, or pass it across network boundaries.

    return { dek, vaultPath, version };
  }

  // -------------------------------------------------------------------------
  // getDEK — fetch a specific version of a DEK from Vault.
  //
  // Used during decryption when the envelope carries kekVersion.
  // Supports reading old versions for in-flight rotation transitions.
  // -------------------------------------------------------------------------

  async getDEK(
    firmSlug: string,
    keyType: string,
    version: number
  ): Promise<Buffer> {
    const pathSuffix = keyType === 'data_encryption' ? 'dek' : 'pek';
    const vaultPath = `firms/${firmSlug}/${pathSuffix}`;

    let raw: Record<string, unknown>;
    try {
      // KV-v2: read specific version
      const response = (await (
        this.vault as unknown as {
          kvReadSecret(
            mount: string,
            path: string,
            version: number
          ): Promise<KvReadData>;
        }
      ).kvReadSecret(this.kvMount, vaultPath, version)) as KvReadData;
      raw = response.data.data;
    } catch (err) {
      const wrapped = this.wrapVaultError(err);
      // Distinguish 404 (version not found) from other Vault errors.
      if (
        wrapped instanceof VaultOperationError &&
        wrapped.statusCode === 404
      ) {
        throw new DekVersionNotFoundError(firmSlug, keyType, version);
      }
      throw wrapped;
    }

    const parsed = DekSecretSchema.safeParse(raw);
    if (!parsed.success) {
      throw new VaultOperationError(
        `DEK secret at firms/${firmSlug}/${pathSuffix} (version ${version}) ` +
          'has unexpected shape. Manual Vault inspection required.'
      );
    }

    return Buffer.from(parsed.data.dek_hex, 'hex');
  }

  // -------------------------------------------------------------------------
  // rotateDEK — generate new DEK version, return new version number.
  //
  // The caller (BullMQ kms-rotation worker) is responsible for:
  //   1. Re-encrypting all documents that used the old version.
  //   2. Updating firm_kms_keys: insert new row (version N+1, active),
  //      update old row to status='rotating', then 'retired' after sweep.
  // -------------------------------------------------------------------------

  async rotateDEK(
    firmSlug: string,
    keyType: string
  ): Promise<{ newVersion: number }> {
    const typedKeyType = keyType as 'data_encryption' | 'privilege_encryption';
    const { version: newVersion } = await this.generateDEK(
      firmSlug,
      typedKeyType
    );
    return { newVersion };
  }

  // -------------------------------------------------------------------------
  // health — check Vault seal status
  // -------------------------------------------------------------------------

  async health(): Promise<{ initialized: boolean; sealed: boolean }> {
    try {
      const response = (await (
        this.vault as unknown as {
          healthCheck(): Promise<HealthData>;
        }
      ).healthCheck()) as HealthData;

      if (response.sealed) {
        throw new VaultSealedError();
      }

      return {
        initialized: response.initialized,
        sealed: response.sealed,
      };
    } catch (err) {
      if (err instanceof VaultSealedError) throw err;
      throw this.wrapVaultError(err);
    }
  }

  // -------------------------------------------------------------------------
  // Error normalisation
  // -------------------------------------------------------------------------

  private wrapVaultError(err: unknown): Error {
    if (
      err instanceof VaultSealedError ||
      err instanceof VaultOperationError ||
      err instanceof VaultConnectionError ||
      err instanceof DekVersionNotFoundError
    ) {
      return err;
    }

    // Network-level errors (ECONNREFUSED, ETIMEDOUT, etc.)
    if (err instanceof Error && 'code' in err) {
      return new VaultConnectionError(err);
    }

    // hashi-vault-js throws objects with statusCode + errors[]
    if (
      err !== null &&
      typeof err === 'object' &&
      'statusCode' in err
    ) {
      const vaultErr = err as {
        statusCode: number;
        errors?: string[];
        message?: string;
      };

      if (vaultErr.statusCode === 503) {
        return new VaultSealedError();
      }

      return new VaultOperationError(
        vaultErr.message ?? `Vault returned HTTP ${vaultErr.statusCode}`,
        vaultErr.statusCode,
        vaultErr.errors ?? []
      );
    }

    return new VaultConnectionError(err);
  }
}

// ---------------------------------------------------------------------------
// Singleton export — reads from environment at module load time.
// In tests, construct VaultClient directly with mock config.
// ---------------------------------------------------------------------------

function createVaultClient(): VaultClient {
  const addr = process.env['VAULT_ADDR'];
  const token = process.env['VAULT_TOKEN'];
  const namespace = process.env['VAULT_NAMESPACE'];
  const kvMount = process.env['VAULT_KV_MOUNT'] ?? 'kv';

  if (!addr || !token) {
    throw new Error(
      'VAULT_ADDR and VAULT_TOKEN environment variables are required. ' +
        'See .env.example for setup instructions.'
    );
  }

  return new VaultClient({ endpoint: addr, token, namespace, kvMount });
}

export const vault: VaultClient = createVaultClient();
