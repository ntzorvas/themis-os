// @themisos/db — main exports
export { db, pool } from './client.js';
export {
  FIRM_SCHEMA_REGEX,
  FIRM_SLUG_REGEX,
  MAX_SLUG_LENGTH,
  getFirmSchemaName,
  setTenantSearchPath,
  withTenantContext,
} from './tenant-resolver.js';
export * from './schema/system.js';
export type { Database } from './client.js';
