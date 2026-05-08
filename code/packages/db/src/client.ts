// Database client — postgres.js + Drizzle ORM
// Schema-per-tenant: SET search_path χρειάζεται ανά connection
// Αναλυτικά: docs/v03/tech-stack-v03.md §3

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/system.js';

const DATABASE_URL = process.env['DATABASE_URL'];

if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL δεν έχει οριστεί. Δείτε .env.example για παράδειγμα.'
  );
}

// Connection pool — max 20 connections (per spec)
const pool = postgres(DATABASE_URL, {
  max: parseInt(process.env['DB_POOL_MAX'] ?? '20', 10),
  idle_timeout: 20,
  connect_timeout: 10,
  // Ενεργοποίηση application_name για monitoring
  connection: {
    application_name: `${process.env['PRODUCT_SLUG'] ?? 'themisos'}-api`,
  },
});

// Default client για public schema operations
export const db = drizzle(pool, { schema, logger: process.env['NODE_ENV'] === 'development' });

// Export pool για χρήση σε tenant resolver
export { pool };

export type Database = typeof db;
