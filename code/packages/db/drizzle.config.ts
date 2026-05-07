import type { Config } from 'drizzle-kit';

// Drizzle Kit configuration
// Αναφορά schema: docs/v03/data-model-v03.md §2
const config: Config = {
  schema: './src/schema/**/*.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://localhost:5432/themisos_dev',
  },
  // Verbose logging σε development
  verbose: process.env['NODE_ENV'] !== 'production',
  strict: true,
};

export default config;
