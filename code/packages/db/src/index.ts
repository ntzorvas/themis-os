// @themisos/db — main exports
export { db, pool } from './client';
export {
  FIRM_SCHEMA_REGEX,
  FIRM_SLUG_REGEX,
  MAX_SLUG_LENGTH,
  getFirmSchemaName,
  setTenantSearchPath,
  withTenantContext,
} from './tenant-resolver';
export * from './schema/system';
export type { Database } from './client';
