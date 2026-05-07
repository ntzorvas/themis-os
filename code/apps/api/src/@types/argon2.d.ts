// Minimal type stub for argon2 — covers the API surface used in routes/auth/index.ts.
// Replace with the real package types once `pnpm add argon2` is run.

declare namespace argon2 {
  interface Options {
    type?: number;
    memoryCost?: number;
    timeCost?: number;
    parallelism?: number;
    saltLength?: number;
    hashLength?: number;
    secret?: Buffer;
    raw?: boolean;
  }

  const argon2i: number;
  const argon2d: number;
  const argon2id: number;

  function hash(plain: string | Buffer, options?: Options): Promise<string>;
  function verify(hash: string, plain: string | Buffer, options?: Options): Promise<boolean>;
  function needsRehash(hash: string, options?: Options): boolean;
}

declare module 'argon2' {
  export = argon2;
}
