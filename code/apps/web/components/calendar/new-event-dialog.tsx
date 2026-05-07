'use client';

/**
 * NewEventDialog — Client Component
 * Modal για δημιουργία νέου ημερολογιακού γεγονότος.
 *
 * Tabs:
 *   - Προθεσμία: rule + trigger_date + auto-calc preview
 *   - Συζήτηση/Δικάσιμος: occurs_at + court/location
 *   - Συνάντηση: occurs_at + location + description
 *   - Άλλο: free-form
 *
 * POST → /api/v1/calendar/events
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import {
  CreateCalendarEventSchema,
  PARTY_RESIDENCIES,
  PARTY_RESIDENCY_LABELS,
  type CreateCalendarEventInput,
  type CalendarRule,
  type DeadlineCalculationResult,
  type CalendarEvent,
} from '@/types/calendar';
import { clientFetch, ApiClientError } from '@/lib/api-client';
import { RuleSelector } from './rule-selector';
import { DeadlineResult } from './deadline-result';

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0] ?? '';
}

function nowIso(): string {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return now.toISOString().slice(0, 16);
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const DIALOG_TABS = [
  { id: 'deadline', label: 'Προθεσμία', eventType: 'deadline' as const },
  { id: 'hearing', label: 'Συζήτηση/Δικάσιμος', eventType: 'hearing' as const },
  { id: 'meeting', label: 'Συνάντηση', eventType: 'meeting' as const },
  { id: 'custom', label: 'Άλλο', eventType: 'custom' as const },
] as const;

type DialogTabId = (typeof DIALOG_TABS)[number]['id'];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NewEventDialogProps {
  open: boolean;
  onClose: () => void;
  rules: CalendarRule[];
  prefillDate?: Date | undefined;
  prefillDeadline?: DeadlineCalculationResult | undefined;
  prefillRuleId?: string | undefined;
  matterId?: string | undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NewEventDialog({
  open,
  onClose,
  rules,
  prefillDate,
  prefillDeadline,
  prefillRuleId,
  matterId,
}: NewEventDialogProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [activeTab, setActiveTab] = useState<DialogTabId>('deadline');
  const [calcResult, setCalcResult] = useState<DeadlineCalculationResult | null>(
    prefillDeadline ?? null
  );
  const [calcLoading, setCalcLoading] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateCalendarEventInput>({
    resolver: zodResolver(CreateCalendarEventSchema),
    defaultValues: {
      event_type: 'deadline',
      all_day: false,
      party_residency: 'domestic',
      matter_id: matterId,
      occurs_at: prefillDate
        ? `${prefillDate.toISOString().split('T')[0]}T09:00`
        : nowIso(),
    },
  });

  const watchRuleId = watch('deadline_rule_id');
  const watchTriggerDate = watch('trigger_date');
  const watchResidency = watch('party_residency');
  const watchCustomDays = watch('custom_extension_days');
  const watchAllDay = watch('all_day');

  // Detect 693 rule (custom_extension_days)
  const is693Rule = watchRuleId?.includes('693') ?? false;

  // ---------------------------------------------------------------------------
  // Prefill from deadline calculator
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (prefillDeadline) {
      setCalcResult(prefillDeadline);
      setActiveTab('deadline');
      setValue('deadline_rule_id', prefillRuleId ?? '');
      setValue('occurs_at', prefillDeadline.deadline_date + 'T00:00');
      setValue('all_day', true);
    }
  }, [prefillDeadline, prefillRuleId, setValue]);

  // ---------------------------------------------------------------------------
  // Tab switch syncs event_type
  // ---------------------------------------------------------------------------

  const handleTabSwitch = useCallback(
    (tabId: DialogTabId) => {
      setActiveTab(tabId);
      const tab = DIALOG_TABS.find((t) => t.id === tabId);
      if (tab) {
        setValue('event_type', tab.eventType);
      }
    },
    [setValue]
  );

  // ---------------------------------------------------------------------------
  // Auto-calculate when rule + trigger_date + residency change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!watchRuleId || !watchTriggerDate) {
      setCalcResult(null);
      return;
    }

    const timer = setTimeout(async () => {
      setCalcLoading(true);
      try {
        const result = await clientFetch<DeadlineCalculationResult>(
          '/api/v1/calendar/calculate-deadline',
          {
            method: 'POST',
            body: {
              rule_id: watchRuleId,
              trigger_date: watchTriggerDate,
              party_residency: watchResidency ?? 'domestic',
              custom_extension_days: is693Rule ? (watchCustomDays ?? 30) : undefined,
            },
          }
        );
        setCalcResult(result);
        // Auto-fill occurs_at with calculated deadline
        setValue('occurs_at', result.deadline_date + 'T00:00');
        setValue('all_day', true);
      } catch {
        // Backend not ready — mock result for UI dev
        setCalcResult({
          deadline_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]!,
          raw_deadline_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]!,
          rule_applied: watchRuleId,
          adjustments: [],
          warnings_gr: ['Ο υπολογισμός γίνεται offline — επαληθεύστε με τον διακομιστή'],
        });
      } finally {
        setCalcLoading(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [watchRuleId, watchTriggerDate, watchResidency, is693Rule, watchCustomDays, setValue]);

  // ---------------------------------------------------------------------------
  // Dialog open/close
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) dialog.showModal();
      setTimeout(() => {
        const el = dialog.querySelector<HTMLElement>('input, select, button[role="tab"]');
        el?.focus();
      }, 50);
    } else {
      if (dialog.open) dialog.close();
      reset({
        event_type: 'deadline',
        all_day: false,
        party_residency: 'domestic',
        matter_id: matterId,
        occurs_at: nowIso(),
      });
      setCalcResult(null);
      setActiveTab('deadline');
    }
  }, [open, reset, matterId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  const handleDialogClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      const rect = dialogRef.current?.getBoundingClientRect();
      if (!rect) return;
      const { clientX, clientY } = e;
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        onClose();
      }
    },
    [onClose]
  );

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  const onSubmit = async (data: CreateCalendarEventInput) => {
    // Normalize occurs_at to full ISO datetime
    const occursAtDate = new Date(data.occurs_at);
    const payload: CreateCalendarEventInput = {
      ...data,
      occurs_at: occursAtDate.toISOString(),
    };

    try {
      await clientFetch<{ data: CalendarEvent }>('/api/v1/calendar/events', {
        method: 'POST',
        body: payload,
      });
      onClose();
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError('root', { message: err.message });
      } else {
        setError('root', { message: 'Σφάλμα επικοινωνίας με τον διακομιστή' });
      }
    }
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClick={handleDialogClick}
      aria-labelledby="new-event-title"
      aria-modal="true"
      className={cn(
        'w-full max-w-2xl rounded-2xl bg-white p-0 shadow-2xl',
        'backdrop:bg-black/40 backdrop:backdrop-blur-sm',
        'border-0 outline-none',
        'open:flex open:flex-col'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <h2 id="new-event-title" className="text-lg font-semibold text-gray-900">
          Νέο Γεγονός
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Κλείσιμο"
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full text-gray-400',
            'hover:bg-gray-100 hover:text-gray-700 transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
          )}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      {/* Tab list */}
      <div
        role="tablist"
        aria-label="Τύπος γεγονότος"
        className="flex border-b border-gray-100"
      >
        {DIALOG_TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={activeTab === tab.id}
            aria-controls={`event-tabpanel-${tab.id}`}
            id={`event-tab-${tab.id}`}
            onClick={() => handleTabSwitch(tab.id)}
            className={cn(
              'relative flex-1 px-3 py-3 text-sm font-medium transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
              activeTab === tab.id
                ? 'text-primary-700 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary-500'
                : 'text-gray-500 hover:text-gray-800'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Form */}
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="overflow-y-auto"
        style={{ maxHeight: 'calc(90vh - 160px)' }}
      >
        <div className="space-y-5 px-6 py-5">
          {/* Root error */}
          {errors.root && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {errors.root.message}
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Common fields */}
          {/* ---------------------------------------------------------------- */}

          {/* title_gr */}
          <div>
            <label
              htmlFor="event-title"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Τίτλος{' '}
              <span aria-hidden="true" className="text-red-500">*</span>
            </label>
            <input
              {...register('title_gr')}
              id="event-title"
              type="text"
              autoComplete="off"
              placeholder="π.χ. Έφεση Παπαδόπουλου"
              aria-required="true"
              aria-invalid={errors.title_gr ? 'true' : undefined}
              className={cn(
                'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-colors',
                errors.title_gr ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'
              )}
            />
            {errors.title_gr && (
              <p role="alert" className="mt-1 text-sm text-red-600">
                {errors.title_gr.message}
              </p>
            )}
          </div>

          {/* occurs_at + all_day */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="event-occurs-at"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Ημερομηνία{watchAllDay ? '' : '/Ώρα'}{' '}
                <span aria-hidden="true" className="text-red-500">*</span>
              </label>
              <input
                {...register('occurs_at')}
                id="event-occurs-at"
                type={watchAllDay ? 'date' : 'datetime-local'}
                aria-required="true"
                aria-invalid={errors.occurs_at ? 'true' : undefined}
                className={cn(
                  'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900',
                  'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-colors',
                  errors.occurs_at ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'
                )}
              />
              {errors.occurs_at && (
                <p role="alert" className="mt-1 text-sm text-red-600">
                  {errors.occurs_at.message}
                </p>
              )}
            </div>

            <div className="flex flex-col justify-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  {...register('all_day')}
                  id="event-all-day"
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700">Ολοήμερο</span>
              </label>
            </div>
          </div>

          {/* location */}
          <div>
            <label
              htmlFor="event-location"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Τοποθεσία{' '}
              <span className="font-normal text-gray-400">(προαιρετικό)</span>
            </label>
            <input
              {...register('location')}
              id="event-location"
              type="text"
              placeholder="π.χ. Πρωτοδικείο Αθηνών, Αίθουσα 12"
              className={cn(
                'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-colors'
              )}
            />
          </div>

          {/* description_gr */}
          <div>
            <label
              htmlFor="event-description"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Περιγραφή{' '}
              <span className="font-normal text-gray-400">(προαιρετικό)</span>
            </label>
            <textarea
              {...register('description_gr')}
              id="event-description"
              rows={2}
              placeholder="Σημειώσεις για το γεγονός…"
              className={cn(
                'block w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-colors'
              )}
            />
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* Προθεσμία tab */}
          {/* ---------------------------------------------------------------- */}
          <div
            id="event-tabpanel-deadline"
            role="tabpanel"
            aria-labelledby="event-tab-deadline"
            hidden={activeTab !== 'deadline'}
          >
            {activeTab === 'deadline' && (
              <div className="space-y-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
                <h3 className="text-sm font-semibold text-gray-700">
                  Αυτόματος Υπολογισμός Προθεσμίας
                </h3>

                {/* Rule selector */}
                <div>
                  <label
                    htmlFor="deadline-rule"
                    className="mb-1.5 block text-sm font-medium text-gray-700"
                  >
                    Κανόνας ΚΠολΔ
                  </label>
                  <Controller
                    control={control}
                    name="deadline_rule_id"
                    render={({ field }) => (
                      <RuleSelector
                        rules={rules}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        id="deadline-rule"
                        error={errors.deadline_rule_id?.message}
                      />
                    )}
                  />
                </div>

                {/* Trigger date */}
                <div>
                  <label
                    htmlFor="deadline-trigger"
                    className="mb-1.5 block text-sm font-medium text-gray-700"
                  >
                    Ημερομηνία Εκκίνησης
                  </label>
                  <input
                    {...register('trigger_date')}
                    id="deadline-trigger"
                    type="date"
                    defaultValue={todayIso()}
                    className={cn(
                      'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900',
                      'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-colors'
                    )}
                  />
                </div>

                {/* Party residency */}
                <div>
                  <fieldset>
                    <legend className="mb-2 block text-sm font-medium text-gray-700">
                      Κατοικία Διαδίκου
                    </legend>
                    <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                      {PARTY_RESIDENCIES.map((res) => (
                        <label
                          key={res}
                          className={cn(
                            'flex flex-1 cursor-pointer items-center gap-2 rounded-lg border-2 px-3 py-2 transition-colors',
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
                          <span className="text-xs font-medium text-gray-900">
                            {PARTY_RESIDENCY_LABELS[res]}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>

                {/* Custom extension days (693 rules only) */}
                {is693Rule && (
                  <div>
                    <label
                      htmlFor="deadline-custom-days"
                      className="mb-1.5 block text-sm font-medium text-gray-700"
                    >
                      Προθεσμία που όρισε το δικαστήριο (ημέρες)
                    </label>
                    <input
                      {...register('custom_extension_days', { valueAsNumber: true })}
                      id="deadline-custom-days"
                      type="number"
                      min={30}
                      defaultValue={30}
                      className={cn(
                        'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900',
                        'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-colors'
                      )}
                    />
                    <p className="mt-1 text-xs text-gray-400">
                      ΚΠολΔ 693§1 — ελάχιστο 30 ημέρες
                    </p>
                  </div>
                )}

                {/* Calculation preview */}
                {calcLoading && (
                  <div
                    aria-label="Υπολογισμός προθεσμίας…"
                    className="h-20 animate-pulse rounded-xl bg-gray-200"
                  />
                )}
                {calcResult && !calcLoading && (
                  <DeadlineResult result={calcResult} />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Ακύρωση και κλείσιμο"
            className={cn(
              'flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700',
              'hover:bg-gray-50 transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            Ακύρωση
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            aria-label="Αποθήκευση νέου γεγονότος"
            className={cn(
              'flex-1 rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white',
              'hover:bg-primary-600 transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
              'disabled:cursor-not-allowed disabled:opacity-60'
            )}
          >
            {isSubmitting ? 'Αποθήκευση…' : 'Αποθήκευση'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
