/**
 * @themisos/rules-engine
 *
 * ΚΠολΔ deadline rules engine — public API.
 *
 * Usage:
 *   import { calculateDeadline, getAllRules, getRuleById } from '@themisos/rules-engine';
 */

export { calculateDeadline } from './calculator.js';
export type { DeadlineInput, DeadlineResult, DeadlineAdjustments, PartyResidency } from './calculator.js';

export { getAllRules, getRuleById, loadRulesFromJson, RULES_V1_PATH, RULES_V2_PATH } from './rules.js';
export type { KpoldRule, DateConditional, DateVariant, PreviousVersion } from './rules.js';

export { isBusinessDay, nextBusinessDay, addBusinessDays, addCalendarDays, addCalendarMonths, addCalendarYears } from './business-days.js';

export { isGreekHoliday, getHolidayName, orthodoxEaster } from './holidays.js';

export { isAugust, AUGUST_EXEMPT_RULE_IDS } from './august-suspension.js';
