/**
 * rules.ts
 *
 * Φόρτωση + επικύρωση kpold-rules-top30-v2.json με Zod.
 * Exports: getAllRules, getRuleById (με version-aware υποστήριξη).
 *
 * v2: προστέθηκαν πεδία versioning (effective_from, effective_until,
 * previous_versions, legal_source, requires_legal_review, date_conditional,
 * warnings_gr).
 */

import { z } from 'zod';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Zod schema — mirrors kpold-rules-top30-v2.json structure
// ---------------------------------------------------------------------------

const DurationSchema = z.union([
  z.object({
    value: z.number(),
    unit: z.enum(['days', 'months', 'years', 'business_days', 'business_days_before_auction']),
    note: z.string().optional(),
  }),
  z.object({
    value_min: z.number(),
    value_max: z.number(),
    unit: z.enum(['months']),
  }),
  z.null(),
]);

// DateVariant — για date_conditional rules
const DateVariantSchema = z.object({
  condition: z.string(),
  duration: z.object({
    value: z.number(),
    unit: z.enum(['days', 'months', 'years', 'business_days']),
    note: z.string().optional(),
  }),
  effective_from: z.string(),
  effective_until: z.string().nullable(),
  legal_source: z.string(),
  notes_gr: z.string(),
});

export type DateVariant = z.infer<typeof DateVariantSchema>;

// DateConditional — δυαδικές εκδοχές (πχ 518§2: 1yr vs 2yr)
const DateConditionalSchema = z.object({
  rule_type: z.literal('date_conditional'),
  condition_field: z.enum(['decision_publication_date', 'filing_date', 'service_date']),
  fallback_variant_index: z.number(),
  variants: z.array(DateVariantSchema),
});

export type DateConditional = z.infer<typeof DateConditionalSchema>;

// PreviousVersion
const PreviousVersionSchema = z.object({
  version: z.string(),
  effective_from: z.string(),
  effective_until: z.string(),
  duration: z.union([
    z.object({ value: z.number(), unit: z.string() }),
    z.null(),
  ]),
  legal_source: z.string(),
});

export type PreviousVersion = z.infer<typeof PreviousVersionSchema>;

export const KpoldRuleSchema = z.object({
  rule_id: z.string(),
  kpold_article: z.string(),
  title_gr: z.string(),
  description_gr: z.string(),
  trigger_event: z.string(),
  duration: DurationSchema,
  duration_foreign: z.union([
    z.object({
      value: z.number(),
      unit: z.enum(['days', 'business_days']),
      note: z.string().optional(),
    }),
    z.undefined(),
  ]).optional(),
  duration_katachristiki: z.union([
    z.object({ value: z.number(), unit: z.enum(['years']) }),
    z.undefined(),
  ]).optional(),
  duration_pre_auction: z.union([
    z.object({ value: z.number(), unit: z.string() }),
    z.undefined(),
  ]).optional(),
  date_conditional: DateConditionalSchema.optional(),
  deadline_kind: z.enum([
    'ανατρεπτική',
    'αποκλειστική',
    'ενδεικτική',
    'γενικός_κανόνας',
    'δικαστική_υποχρέωση',
    'δικαστική_ευχέρεια',
    'procedural_rule',
  ]),
  business_days_only: z.boolean(),
  skip_august: z.boolean(),
  weekend_rollover: z.enum(['next_business_day', 'previous_business_day']),
  notes_gr: z.string(),
  edge_cases: z.array(z.string()),
  frequency_score: z.number(),
  last_amended_by: z.string(),
  // v2 versioning fields
  version: z.string().optional(),
  effective_from: z.string().optional(),
  effective_until: z.string().nullable().optional(),
  legal_source: z.string().optional(),
  requires_legal_review: z.boolean().optional(),
  requires_legal_review_reason: z.string().optional(),
  warnings_gr: z.array(z.string()).optional(),
  previous_versions: z.array(PreviousVersionSchema).optional(),
});

export type KpoldRule = z.infer<typeof KpoldRuleSchema>;

// ---------------------------------------------------------------------------
// File paths — v1 and v2
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RULES_V1_PATH = join(__dirname, '..', '..', '..', 'docs', 'research', 'kpold-rules-top30.json');
const RULES_V2_PATH = join(__dirname, '..', '..', '..', 'docs', 'research', 'kpold-rules-top30-v2.json');

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let _rulesCache: ReadonlyArray<KpoldRule> | null = null;
let _rulesCachePath: string | null = null;

// ---------------------------------------------------------------------------
// Core loader
// ---------------------------------------------------------------------------

/**
 * Φορτώνει και επικυρώνει κανόνες από δεδομένο path (lazy, με cache per path).
 * Throws αν JSON δεν επικυρωθεί.
 */
function loadRulesFromPath(rulesPath: string): ReadonlyArray<KpoldRule> {
  if (_rulesCache !== null && _rulesCachePath === rulesPath) return _rulesCache;

  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const raw: unknown = require(rulesPath);

  const parsed = z.array(KpoldRuleSchema).safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Rules JSON επικύρωση απέτυχε (${rulesPath}): ${parsed.error.issues.map((i) => i.message).join('; ')}`
    );
  }

  _rulesCache = parsed.data;
  _rulesCachePath = rulesPath;
  return _rulesCache;
}

// ---------------------------------------------------------------------------
// loadRulesFromJson — public, switches cache to given path
// ---------------------------------------------------------------------------

/**
 * Φορτώνει κανόνες από συγκεκριμένο path.
 * Χρήση: loadRulesFromJson(RULES_V2_PATH) για εναλλαγή σε v2.
 */
export function loadRulesFromJson(path: string): ReadonlyArray<KpoldRule> {
  return loadRulesFromPath(path);
}

// ---------------------------------------------------------------------------
// getAllRules — επιστρέφει active rules (default: v2)
// ---------------------------------------------------------------------------

/**
 * Επιστρέφει active κανόνες από v2 JSON.
 *
 * @param asOfDate - Αν δοθεί, φιλτράρει κανόνες που ίσχυαν εκείνη την ημέρα.
 *                  Default = τρέχουσα ημέρα (επιστρέφει τους τρέχοντες).
 */
export function getAllRules(asOfDate?: Date): ReadonlyArray<KpoldRule> {
  const rules = loadRulesFromPath(RULES_V2_PATH);

  if (asOfDate === undefined) {
    return rules;
  }

  const asOfStr = asOfDate.toISOString().split('T')[0] ?? '';

  return rules.filter((r) => {
    const from = r.effective_from;
    const until = r.effective_until;
    if (from !== undefined && from > asOfStr) return false;
    if (until !== null && until !== undefined && until < asOfStr) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// getRuleById — version-aware
// ---------------------------------------------------------------------------

/**
 * Επιστρέφει κανόνα με βάση rule_id.
 *
 * @param ruleId - Το rule_id
 * @param asOfDate - Αν δοθεί, επιστρέφει την έκδοση που ίσχυε εκείνη την ημέρα.
 *                  Default = τρέχουσα (επιστρέφει την τελευταία active).
 *
 * Throws αν δεν βρεθεί.
 */
export function getRuleById(ruleId: string, asOfDate?: Date): KpoldRule {
  const rules = getAllRules(asOfDate);
  const rule = rules.find((r) => r.rule_id === ruleId);
  if (rule === undefined) {
    throw Object.assign(
      new Error(`Κανόνας με rule_id "${ruleId}" δεν βρέθηκε.`),
      { code: 'RULE_NOT_FOUND', statusCode: 404 }
    );
  }
  return rule;
}

// ---------------------------------------------------------------------------
// Re-export paths for external use (tests, scripts)
// ---------------------------------------------------------------------------

export { RULES_V1_PATH, RULES_V2_PATH };
