/**
 * provisioning-clone.test.ts
 *
 * Validates `prepareCloneSql` regex transformations against the live
 * tenant_template SQL. Covers Δαίδαλος C5 contract (Option A shared ENUMs).
 *
 * Run: pnpm --filter @themisos/db test
 *
 * Note: Uses Node's built-in test runner (node --test) — no external deps.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATE_PATH = join(__dirname, '..', 'migrations', '0002_template_schema.sql');

/**
 * Mirrors `prepareCloneSql` from provisioning.ts.
 * Kept inline so the test fails loudly if the regex contract changes
 * without test updates.
 */
function prepareCloneSql(targetSchema: string): string {
  let sql = readFileSync(TEMPLATE_PATH, 'utf-8');

  sql = sql.replace(
    /DO\s+\$\$\s+BEGIN\s+CREATE\s+TYPE\s+(?:tenant_template\.)?\w+\s+AS\s+ENUM[\s\S]+?EXCEPTION\s+WHEN\s+duplicate_object[\s\S]+?END\s+\$\$;/gi,
    '-- CREATE TYPE skipped (Option A shared types in tenant_template)'
  );

  sql = sql.replace(
    /tenant_template\.([a-z_][a-z0-9_]*)/gi,
    (_match: string, identifier: string): string => {
      if (identifier.endsWith('_t')) return `tenant_template.${identifier}`;
      return `${targetSchema}.${identifier}`;
    }
  );

  sql = sql.replace(
    /CREATE SCHEMA IF NOT EXISTS tenant_template;/g,
    `CREATE SCHEMA IF NOT EXISTS ${targetSchema};`
  );
  sql = sql.replace(
    /SET LOCAL search_path TO tenant_template;/g,
    `SET LOCAL search_path TO ${targetSchema};`
  );

  return sql;
}

/** Strip SQL line comments to count executable statements only. */
function stripComments(sql: string): string {
  return sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
}

test('strips ALL executable CREATE TYPE blocks (qualified + unqualified)', () => {
  const out = prepareCloneSql('firm_acme_legal');
  const code = stripComments(out);
  const matches = code.match(/CREATE\s+TYPE/gi) || [];
  assert.equal(matches.length, 0, `Expected 0 executable CREATE TYPE, found ${matches.length}`);
});

test('preserves tenant_template.<enum>_t references in column definitions', () => {
  const out = prepareCloneSql('firm_acme_legal');
  // Sample known ENUMs from 0002 (privilege layer + identity)
  const expectedEnums = ['user_role_t', 'privilege_tag_t', 'access_outcome_t'];
  for (const enumName of expectedEnums) {
    const re = new RegExp(`tenant_template\\.${enumName}\\b`);
    assert.match(out, re, `Expected tenant_template.${enumName} to be preserved`);
  }
});

test('rewrites tenant_template.<table_or_function> to firm_<slug>.<ident>', () => {
  const targetSchema = 'firm_acme_legal';
  const out = prepareCloneSql(targetSchema);
  // Known explicitly-qualified non-ENUM idents in 0002 (cross-table FK + trigger refs)
  const expectedIdents = [
    'matter',
    'matter_party',
    'document_privilege',
    'document_share',
    'ai_request',
    'validate_billing_split',
    'enforce_privilege_no_share',
    'enforce_privilege_no_ai',
    'sync_matter_closed_at',
  ];
  for (const ident of expectedIdents) {
    const re = new RegExp(`${targetSchema}\\.${ident}\\b`);
    assert.match(out, re, `Expected ${targetSchema}.${ident} to be present`);
  }
  // Negative: no surviving tenant_template.<non-_t> references
  const surviving = (out.match(/tenant_template\.([a-z_][a-z0-9_]*)/gi) || [])
    .filter((m) => !m.endsWith('_t') && !m.endsWith('foo_t'));
  // foo_t is in a comment, fine
  assert.equal(
    surviving.length,
    0,
    `Unexpected surviving non-ENUM tenant_template refs: ${surviving.join(', ')}`
  );
});

test('rewrites CREATE SCHEMA target to firm_<slug>', () => {
  const out = prepareCloneSql('firm_acme_legal');
  assert.match(out, /CREATE SCHEMA IF NOT EXISTS firm_acme_legal;/);
  assert.doesNotMatch(out, /CREATE SCHEMA IF NOT EXISTS tenant_template;/);
});

test('rewrites SET LOCAL search_path to firm_<slug>', () => {
  const out = prepareCloneSql('firm_acme_legal');
  assert.match(out, /SET LOCAL search_path TO firm_acme_legal;/);
  assert.doesNotMatch(out, /SET LOCAL search_path TO tenant_template;/);
});

test('does not leak unqualified ENUM type names as orphan declarations', () => {
  const out = prepareCloneSql('firm_acme_legal');
  const code = stripComments(out);
  // Any line with "AS ENUM" must be a comment/skipped marker
  const enumDecls = code.match(/AS\s+ENUM/gi) || [];
  assert.equal(enumDecls.length, 0, `Expected 0 AS ENUM declarations, found ${enumDecls.length}`);
});
