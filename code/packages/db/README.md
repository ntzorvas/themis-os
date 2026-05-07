# @themisos/db

Drizzle ORM schema, migrations, και tenant resolver για ΘΕΜΙΣ OS.

## Εντολές

```bash
# Δημιουργία migration από schema αλλαγές
pnpm db:generate

# Εφαρμογή migrations στη βάση
pnpm db:migrate

# Drizzle Studio (visual DB browser)
pnpm db:studio

# Push schema χωρίς migration file (μόνο development)
pnpm db:push
```

## Αρχιτεκτονική

- **`public` schema**: cross-tenant (firms, subscriptions, auth sessions)
- **`firm_<slug>` schema**: per-tenant (parties, matters, documents, invoices...)
- **`template` schema**: DDL template για νέους tenants (Day 2 migration)

Αναλυτικά: `../../docs/v03/data-model-v03.md`

## Tenant Resolver

```typescript
import { getFirmSchemaName, withTenantContext } from '@themisos/db';

// Μετατροπή slug → schema name
getFirmSchemaName('acme-legal'); // → 'firm_acme_legal'

// Tenant-scoped query
await withTenantContext(sql, 'acme-legal', async () => {
  // Εδώ search_path = firm_acme_legal, public
});
```
