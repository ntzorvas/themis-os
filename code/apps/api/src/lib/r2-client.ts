/**
 * R2 client wrapper — Cloudflare R2 via S3-compatible API (AWS SDK v3)
 *
 * Mock mode: αν R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
 * δεν είναι set → in-memory Map<key, Buffer>. Warning στο startup.
 *
 * Production mode: @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner
 * με EU endpoint `https://<accountId>.r2.cloudflarestorage.com`.
 * AWS SDK imports γίνονται dynamic + typed via explicit interface — αποφεύγουμε
 * hard compile-time dep όταν τα packages δεν είναι installed.
 *
 * INVARIANT #9: Αυτός ο client δεν γνωρίζει κρυπτογράφηση —
 * ανεβάζει/κατεβάζει bytes ως-έχουν. Ο καλών φέρει ευθύνη για encrypt/decrypt.
 *
 * PENDING (Niko action): pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 * στο apps/api — activates real R2 mode automatically when R2_* env vars set.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface R2ClientConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
}

// Minimal S3 interfaces — allows real mode without requiring @aws-sdk at compile time
interface S3LikeClient {
  send(cmd: unknown): Promise<{ Body?: unknown }>;
}

interface S3Modules {
  S3Client: new (config: {
    region: string;
    endpoint: string;
    credentials: { accessKeyId: string; secretAccessKey: string };
  }) => S3LikeClient;
  PutObjectCommand: new (input: {
    Bucket: string;
    Key: string;
    Body: Buffer;
    ContentType: string;
    ContentLength: number;
  }) => unknown;
  GetObjectCommand: new (input: { Bucket: string; Key: string }) => unknown;
  DeleteObjectCommand: new (input: { Bucket: string; Key: string }) => unknown;
}

interface PresignerModule {
  getSignedUrl: (client: S3LikeClient, cmd: unknown, opts: { expiresIn: number }) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Mock store — in-memory, process-scoped
// ---------------------------------------------------------------------------

const mockStore = new Map<string, Buffer>();
let mockModeWarned = false;

function warnMockMode(): void {
  if (!mockModeWarned) {
    console.warn(
      '[R2] Using in-memory mock — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, ' +
        'R2_SECRET_ACCESS_KEY, R2_BUCKET env vars for production. ' +
        'Run: pnpm --filter @themisos/api add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner'
    );
    mockModeWarned = true;
  }
}

// ---------------------------------------------------------------------------
// R2Client
// ---------------------------------------------------------------------------

export class R2Client {
  private readonly config: R2ClientConfig | null;
  private readonly mock: boolean;

  constructor(config: R2ClientConfig | null) {
    this.config = config;
    this.mock = config === null;
    if (this.mock) warnMockMode();
  }

  // -------------------------------------------------------------------------
  // loadS3Modules — dynamic import; throws if aws-sdk not installed
  // -------------------------------------------------------------------------

  private async loadS3Modules(): Promise<S3Modules> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await import('@aws-sdk/client-s3' as string)) as unknown as S3Modules;
    } catch {
      throw new Error(
        '@aws-sdk/client-s3 is not installed. ' +
          'Run: pnpm --filter @themisos/api add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner'
      );
    }
  }

  private async loadPresigner(): Promise<PresignerModule> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await import('@aws-sdk/s3-request-presigner' as string)) as unknown as PresignerModule;
    } catch {
      throw new Error(
        '@aws-sdk/s3-request-presigner is not installed. ' +
          'Run: pnpm --filter @themisos/api add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner'
      );
    }
  }

  private makeS3Client(mods: S3Modules): S3LikeClient {
    const cfg = this.config!;
    return new mods.S3Client({
      region: 'auto',
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }

  // -------------------------------------------------------------------------
  // uploadObject — upload raw bytes to a key
  // -------------------------------------------------------------------------

  async uploadObject(key: string, body: Buffer, contentType?: string): Promise<void> {
    if (this.mock) {
      mockStore.set(key, body);
      console.log(`[R2 mock] PUT ${key} (${body.length} bytes)`);
      return;
    }

    const mods = await this.loadS3Modules();
    const s3 = this.makeS3Client(mods);
    await s3.send(
      new mods.PutObjectCommand({
        Bucket: this.config!.bucket,
        Key: key,
        Body: body,
        ContentType: contentType ?? 'application/octet-stream',
        ContentLength: body.length,
      })
    );
  }

  // -------------------------------------------------------------------------
  // getObject — download raw bytes from a key
  // -------------------------------------------------------------------------

  async getObject(key: string): Promise<Buffer> {
    if (this.mock) {
      const stored = mockStore.get(key);
      if (stored === undefined) {
        throw Object.assign(new Error(`R2 mock: key not found: ${key}`), {
          code: 'R2_NOT_FOUND',
        });
      }
      console.log(`[R2 mock] GET ${key} (${stored.length} bytes)`);
      return stored;
    }

    const mods = await this.loadS3Modules();
    const s3 = this.makeS3Client(mods);

    const response = await s3.send(
      new mods.GetObjectCommand({ Bucket: this.config!.bucket, Key: key })
    );

    if (response.Body === undefined) {
      throw Object.assign(new Error(`R2: empty body for key: ${key}`), {
        code: 'R2_EMPTY_BODY',
      });
    }

    // AWS SDK v3 Body is a Readable stream — collect into Buffer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = response.Body as AsyncIterable<any>;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }

  // -------------------------------------------------------------------------
  // deleteObject — remove a key from R2
  // -------------------------------------------------------------------------

  async deleteObject(key: string): Promise<void> {
    if (this.mock) {
      mockStore.delete(key);
      console.log(`[R2 mock] DELETE ${key}`);
      return;
    }

    const mods = await this.loadS3Modules();
    const s3 = this.makeS3Client(mods);
    await s3.send(new mods.DeleteObjectCommand({ Bucket: this.config!.bucket, Key: key }));
  }

  // -------------------------------------------------------------------------
  // getPresignedUrl — signed URL (GET, 5-minute TTL by default)
  // Day 7: server-side decrypt+stream is the primary download path.
  // Presigned URLs expose raw R2 bytes (encrypted) — for export/audit only.
  // -------------------------------------------------------------------------

  async getPresignedUrl(key: string, ttlSeconds: number = 300): Promise<string> {
    if (this.mock) {
      const mockUrl = `http://localhost:4000/api/v1/__r2-mock/${encodeURIComponent(key)}?ttl=${String(ttlSeconds)}`;
      console.log(`[R2 mock] PRESIGN ${key} → ${mockUrl}`);
      return mockUrl;
    }

    const mods = await this.loadS3Modules();
    const presigner = await this.loadPresigner();
    const s3 = this.makeS3Client(mods);
    const command = new mods.GetObjectCommand({ Bucket: this.config!.bucket, Key: key });
    return presigner.getSignedUrl(s3, command, { expiresIn: ttlSeconds });
  }

  // -------------------------------------------------------------------------
  // isMock — for startup logging
  // -------------------------------------------------------------------------

  get isMock(): boolean {
    return this.mock;
  }
}

// ---------------------------------------------------------------------------
// Singleton — reads from environment at module load time
// ---------------------------------------------------------------------------

function createR2Client(): R2Client {
  const accountId = process.env['R2_ACCOUNT_ID'];
  const accessKeyId = process.env['R2_ACCESS_KEY_ID'];
  const secretAccessKey = process.env['R2_SECRET_ACCESS_KEY'];
  const bucket = process.env['R2_BUCKET'];
  const region = process.env['R2_REGION'] ?? 'auto';

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return new R2Client(null);
  }

  return new R2Client({ accountId, accessKeyId, secretAccessKey, bucket, region });
}

export const r2 = createR2Client();
