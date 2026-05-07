// Schema: public (shared, cross-tenant)
// Χρησιμοποιείται για bootstrapping και health checks
// Πλήρης schema: docs/v03/data-model-v03.md §2

import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Απλός πίνακας για επαλήθευση ότι οι migrations δουλεύουν
// Αντικαθίσταται από το πλήρες public schema στο Day 2 migration
export const systemHealth = pgTable('system_health', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type SystemHealth = typeof systemHealth.$inferSelect;
export type NewSystemHealth = typeof systemHealth.$inferInsert;
