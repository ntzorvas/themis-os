'use client';

/**
 * /calendar/calculator — Standalone Deadline Calculator Tool
 *
 * - Rule dropdown (grouped, 30 rules, με search)
 * - Trigger date picker
 * - Party residency radio
 * - Conditional custom_extension_days (693 rules)
 * - "Υπολόγισε" → POST /api/v1/calendar/calculate-deadline
 * - Result panel: big date, adjustments, warnings
 * - "Αποθήκευση ως γεγονός" → NewEventDialog prefilled
 *
 * Backend mock fallback: αν 404 → demo calculation
 */

import { useState, useCallback } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { z } from 'zod';
import {
  PARTY_RESIDENCIES,
  PARTY_RESIDENCY_LABELS,
  GREEK_MONTHS_FULL,
  type CalendarRule,
  type DeadlineCalculationResult,
  type PartyResidency,
} from '@/types/calendar';
import { RuleSelector } from '@/components/calendar/rule-selector';
import { DeadlineResult } from '@/components/calendar/deadline-result';
import { NewEventDialog } from '@/components/calendar/new-event-dialog';
import { clientFetch } from '@/lib/api-client';

// Static rule data (from kpold-rules-top30.json) — loaded client-side as fallback
import STATIC_RULES_RAW from '@/lib/calendar-rules-static';

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0] ?? '';
}

// ---------------------------------------------------------------------------
// Form schema
// ---------------------------------------------------------------------------

const CalculatorSchema = z.object({
  rule_id: z.string().min(1, 'Επιλέξτε κανόνα ΚΠολΔ'),
  trigger_date: z.string().min(1, 'Επιλέξτε ημερομηνία εκκίνησης'),
  party_residency: z.enum(PARTY_RESIDENCIES),
  custom_extension_days: z.number().int().min(30).optional(),
});

type CalculatorInput = z.infer<typeof CalculatorSchema>;

// ---------------------------------------------------------------------------
// Mock calculation (για dev όταν backend δεν είναι έτοιμο)
// ---------------------------------------------------------------------------

function mockCalculate(
  ruleId: string,
  triggerDate: string,
  residency: PartyResidency,
  customDays?: number
): DeadlineCalculationResult {
  const rule = STATIC_RULES_RAW.find((r) => r.rule_id === ruleId);
  const trigger = new Date(`${triggerDate}T12:00:00`);

  let baseDays = 30;
  if (rule) {
    const dur = rule.duration as { value?: number; unit?: string } | null;
    if (dur?.unit === 'days' || dur?.unit === 'business_days') {
      baseDays = dur.value ?? 30;
    } else if (dur?.unit === 'months') {
      baseDays = (dur.value ?? 1) * 30;
    } else if (dur?.unit === 'years') {
      baseDays = (dur.value ?? 1) * 365;
    }
  }

  if (ruleId.includes('693') && customDays) {
    baseDays = customDays;
  }

  // Foreign extension
  let foreignExtra = 0;
  if (residency !== 'domestic') {
    const foreignDur = rule?.duration_foreign as { value?: number } | undefined;
    if (foreignDur?.value) {
      foreignExtra = foreignDur.value - baseDays;
    } else {
      foreignExtra = 30;
    }
  }

  const rawDate = new Date(trigger);
  rawDate.setDate(rawDate.getDate() + baseDays + foreignExtra);

  // August suspension simulation
  const adjustments: DeadlineCalculationResult['adjustments'] = [];
  let finalDate = new Date(rawDate);
  const warnings: string[] = [];

  if (rule?.skip_august) {
    const startYear = finalDate.getFullYear();
    // Check if deadline crosses August
    const aug1 = new Date(startYear, 7, 1);
    const aug31 = new Date(startYear, 7, 31);
    if (finalDate >= aug1 && finalDate <= aug31) {
      finalDate = new Date(startYear, 8, 1);
      adjustments.push({
        type: 'august_suspension',
        description_gr: 'Η ημερομηνία εμπίπτει σε Αύγουστο — μεταφέρεται στην 1η Σεπτεμβρίου',
        days_added: 0,
      });
    }
  }

  // Weekend rollover
  const dow = finalDate.getDay();
  if (dow === 0) {
    finalDate.setDate(finalDate.getDate() + 1);
    adjustments.push({
      type: 'weekend_rollover',
      description_gr: 'Η ημερομηνία πέφτει Κυριακή — μεταφέρεται στη Δευτέρα',
      days_added: 1,
    });
  } else if (dow === 6) {
    finalDate.setDate(finalDate.getDate() + 2);
    adjustments.push({
      type: 'weekend_rollover',
      description_gr: 'Η ημερομηνία πέφτει Σάββατο — μεταφέρεται τη Δευτέρα',
      days_added: 2,
    });
  }

  if (residency !== 'domestic') {
    adjustments.push({
      type: 'foreign_extension',
      description_gr: `Παρέκταση ${foreignExtra} ημερών για κατοίκους ${PARTY_RESIDENCY_LABELS[residency]}`,
      days_added: foreignExtra,
    });
  }

  if (rule?.notes_gr) {
    warnings.push('Αποτέλεσμα εκτίμησης — επαληθεύστε με τον διακομιστή όταν είναι διαθέσιμος');
  }

  return {
    deadline_date: finalDate.toISOString().split('T')[0]!,
    raw_deadline_date: rawDate.toISOString().split('T')[0]!,
    rule_applied: rule ? `${rule.kpold_article} — ${rule.title_gr}` : ruleId,
    adjustments,
    warnings_gr: warnings,
  };
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function DeadlineCalculatorPage() {
  const [rules] = useState<CalendarRule[]>(STATIC_RULES_RAW as CalendarRule[]);
  const [result, setResult] = useState<DeadlineCalculationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [newEventOpen, setNewEventOpen] = useState(false);

  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<CalculatorInput>({
    resolver: zodResolver(CalculatorSchema),
    defaultValues: {
      trigger_date: todayIso(),
      party_residency: 'domestic',
    },
  });

  const watchRuleId = watch('rule_id');
  const watchResidency = watch('party_residency');
  const is693Rule = watchRuleId?.includes('693') ?? false;

  const onCalculate = useCallback(
    async (data: CalculatorInput) => {
      setLoading(true);
      setResult(null);
      try {
        const res = await clientFetch<DeadlineCalculationResult>(
          '/api/v1/calendar/calculate-deadline',
          {
            method: 'POST',
            body: {
              rule_id: data.rule_id,
              trigger_date: data.trigger_date,
              party_residency: data.party_residency,
              custom_extension_days: is693Rule ? data.custom_extension_days : undefined,
            },
          }
        );
        setResult(res);
      } catch {
        // Backend not ready — use mock
        setResult(
          mockCalculate(
            data.rule_id,
            data.trigger_date,
            data.party_residency,
            data.custom_extension_days
          )
        );
      } finally {
        setLoading(false);
      }
    },
    [is693Rule]
  );

  const selectedRule = rules.find((r) => r.rule_id === watchRuleId);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex items-center gap-2 text-sm text-gray-500">
          <li>
            <Link
              href="/calendar"
              className="hover:text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 rounded"
            >
              Ημερολόγιο
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li className="font-medium text-gray-900" aria-current="page">
            Υπολογιστής Προθεσμιών
          </li>
        </ol>
      </nav>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Υπολογιστής Προθεσμιών ΚΠολΔ
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Επιλέξτε κανόνα, ημερομηνία εκκίνησης και κατοικία διαδίκου για αυτόματο υπολογισμό προθεσμίας.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Input panel */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            Στοιχεία Υπολογισμού
          </h2>

          <form
            onSubmit={handleSubmit(onCalculate)}
            noValidate
            className="space-y-5"
          >
            {/* Rule selector */}
            <div>
              <label
                htmlFor="calc-rule"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Κανόνας ΚΠολΔ{' '}
                <span aria-hidden="true" className="text-red-500">*</span>
              </label>
              <Controller
                control={control}
                name="rule_id"
                render={({ field }) => (
                  <RuleSelector
                    rules={rules}
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    id="calc-rule"
                    error={errors.rule_id?.message}
                  />
                )}
              />

              {/* Description tooltip */}
              {selectedRule && (
                <div className="mt-2 rounded-md bg-blue-50 border border-blue-100 px-3 py-2">
                  <p className="text-xs text-blue-700 leading-relaxed">
                    {selectedRule.description_gr}
                  </p>
                </div>
              )}
            </div>

            {/* Trigger date */}
            <div>
              <label
                htmlFor="calc-trigger-date"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Ημερομηνία Εκκίνησης{' '}
                <span aria-hidden="true" className="text-red-500">*</span>
              </label>
              <input
                {...register('trigger_date')}
                id="calc-trigger-date"
                type="date"
                aria-required="true"
                aria-invalid={errors.trigger_date ? 'true' : undefined}
                className={cn(
                  'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900',
                  'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-colors',
                  errors.trigger_date ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'
                )}
              />
              {errors.trigger_date && (
                <p role="alert" className="mt-1 text-sm text-red-600">
                  {errors.trigger_date.message}
                </p>
              )}
            </div>

            {/* Party residency */}
            <fieldset>
              <legend className="mb-2 block text-sm font-medium text-gray-700">
                Κατοικία Διαδίκου{' '}
                <span aria-hidden="true" className="text-red-500">*</span>
              </legend>
              <div className="flex flex-col gap-2">
                {PARTY_RESIDENCIES.map((res) => (
                  <label
                    key={res}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg border-2 px-3 py-2.5 transition-colors',
                      'focus-within:ring-2 focus-within:ring-primary-500 focus-within:ring-offset-1',
                      watchResidency === res
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    )}
                  >
                    <input
                      {...register('party_residency')}
                      type="radio"
                      value={res}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm font-medium text-gray-900">
                      {PARTY_RESIDENCY_LABELS[res]}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Custom extension days (693 rules) */}
            {is693Rule && (
              <div>
                <label
                  htmlFor="calc-custom-days"
                  className="mb-1.5 block text-sm font-medium text-gray-700"
                >
                  Προθεσμία κατά δικαστή (ημέρες){' '}
                  <span aria-hidden="true" className="text-red-500">*</span>
                </label>
                <input
                  {...register('custom_extension_days', { valueAsNumber: true })}
                  id="calc-custom-days"
                  type="number"
                  min={30}
                  defaultValue={30}
                  aria-required="true"
                  className={cn(
                    'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900',
                    'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-colors',
                    errors.custom_extension_days ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'
                  )}
                />
                <p className="mt-1 text-xs text-gray-400">
                  ΚΠολΔ 693§1 — ελάχιστο 30 ημέρες, ορίζεται από το δικαστήριο
                </p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              aria-label="Υπολογισμός προθεσμίας"
              className={cn(
                'w-full rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white',
                'hover:bg-primary-600 transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
                'disabled:cursor-not-allowed disabled:opacity-60'
              )}
            >
              {loading ? 'Υπολογισμός…' : 'Υπολόγισε'}
            </button>
          </form>
        </div>

        {/* Result panel */}
        <div>
          {loading && (
            <div
              aria-label="Υπολογισμός προθεσμίας…"
              className="h-64 animate-pulse rounded-xl bg-gray-100"
            />
          )}

          {result && !loading && (
            <DeadlineResult
              result={result}
              onSaveAsEvent={() => setNewEventOpen(true)}
            />
          )}

          {!result && !loading && (
            <div className="flex h-full min-h-[200px] items-center justify-center rounded-xl border-2 border-dashed border-gray-200">
              <div className="text-center">
                <p className="text-sm font-medium text-gray-400">
                  Συμπληρώστε τα στοιχεία και
                </p>
                <p className="text-sm text-gray-400">
                  πατήστε &ldquo;Υπολόγισε&rdquo;
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New event dialog — prefilled από result */}
      <NewEventDialog
        open={newEventOpen}
        onClose={() => setNewEventOpen(false)}
        rules={rules}
        prefillDeadline={result ?? undefined}
        prefillRuleId={watchRuleId}
      />
    </main>
  );
}
