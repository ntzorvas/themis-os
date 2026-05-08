/**
 * @themisos/rules-engine
 *
 * ΚΠολΔ deadline rules engine — public API.
 *
 * Usage:
 *   import { calculateDeadline, getAllRules, getRuleById } from '@themisos/rules-engine';
 */

export { calculateDeadline } from './calculator';
export type { DeadlineInput, DeadlineResult, DeadlineAdjustments, PartyResidency } from './calculator';

export { getAllRules, getRuleById, loadRulesFromJson, RULES_V1_PATH, RULES_V2_PATH } from './rules';
export type { KpoldRule, DateConditional, DateVariant, PreviousVersion } from './rules';

export { isBusinessDay, nextBusinessDay, addBusinessDays, addCalendarDays, addCalendarMonths, addCalendarYears } from './business-days';

export { isGreekHoliday, getHolidayName, orthodoxEaster } from './holidays';

export { isAugust, AUGUST_EXEMPT_RULE_IDS } from './august-suspension';
