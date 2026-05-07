'use client';

/**
 * AddPartyToMatterDialog — Client Component
 * Modal για προσθήκη υπάρχοντος συμβαλλομένου σε υπόθεση.
 *
 * - Search/select existing party (GET /api/v1/parties?q=...)
 * - side: ours/opponent/neutral (required)
 * - role: matter_party_role_t (required)
 * - billing_split_percentage: 0-100 integer (optional)
 * - is_primary_contact: checkbox (UX: disable if side already has primary)
 *
 * POST → /api/v1/matters/:id/parties
 *
 * Critical validations:
 * - billing_split_percentage must be 0-100 integer
 * - Side='ours' sum warning αν SUM != 100 (server rejects anyway)
 * - is_primary_contact: UX-disable αν already exists per side (prop: existingPrimaryContactSides)
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import {
  AddPartyToMatterSchema,
  MATTER_PARTY_ROLES,
  MATTER_PARTY_ROLE_LABELS,
  MATTER_PARTY_SIDES,
  MATTER_PARTY_SIDE_LABELS,
  type AddPartyToMatterInput,
  type MatterParty,
  type MatterPartySide,
} from '@/types/matters';
import { type Party } from '@/types/parties';
import { clientFetch, ApiClientError } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AddPartyToMatterDialogProps {
  matterId: string;
  open: boolean;
  onClose: () => void;
  /** Sides that already have is_primary_contact=true — UX disables checkbox for those sides */
  existingPrimaryContactSides: MatterPartySide[];
  /** Current 'ours' side billing split total — for warn-only UX hint */
  oursSplitTotal: number;
}

// ---------------------------------------------------------------------------
// Party search component
// ---------------------------------------------------------------------------

interface PartySearchProps {
  value: string | null;
  onChange: (partyId: string, displayName: string) => void;
  error?: string | undefined;
}

function PartySearch({ value, onChange, error }: PartySearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Party[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedName, setSelectedName] = useState<string>('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const data = await clientFetch<{ data: Party[] }>(
        `/api/v1/parties?q=${encodeURIComponent(q)}&limit=10`
      );
      setResults(data.data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (value !== null) {
      // Clear selection if user types
      onChange('', '');
      setSelectedName('');
    }
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void search(q);
    }, 300);
  };

  const selectParty = (party: Party) => {
    onChange(party.id, party.display_name);
    setSelectedName(party.display_name);
    setQuery(party.display_name);
    setResults([]);
  };

  return (
    <div className="relative">
      <label
        htmlFor="party-search-input"
        className="mb-1.5 block text-sm font-medium text-gray-700"
      >
        Συμβαλλόμενος{' '}
        <span aria-hidden="true" className="text-red-500">
          *
        </span>
      </label>
      <input
        id="party-search-input"
        type="text"
        autoComplete="off"
        value={value && selectedName ? selectedName : query}
        onChange={handleInput}
        placeholder="Αναζήτηση ονόματος…"
        aria-required="true"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'party-search-error' : undefined}
        className={cn(
          'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400',
          'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
          'transition-colors',
          error ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'
        )}
      />
      {error && (
        <p id="party-search-error" role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
      {loading && (
        <p className="mt-1 text-xs text-gray-400" aria-live="polite">
          Αναζήτηση…
        </p>
      )}
      {results.length > 0 && (
        <ul
          role="listbox"
          aria-label="Αποτελέσματα αναζήτησης"
          className={cn(
            'absolute z-50 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg',
            'max-h-48 overflow-y-auto'
          )}
        >
          {results.map((party) => (
            <li key={party.id} role="option" aria-selected={party.id === value}>
              <button
                type="button"
                onClick={() => selectParty(party)}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-gray-50',
                  'focus-visible:bg-gray-50 focus-visible:outline-none'
                )}
              >
                <span className="font-medium text-gray-900">
                  {party.display_name}
                </span>
                {party.afm && (
                  <span className="font-mono text-xs text-gray-400">
                    ΑΦΜ {party.afm}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AddPartyToMatterDialog({
  matterId,
  open,
  onClose,
  existingPrimaryContactSides,
  oursSplitTotal,
}: AddPartyToMatterDialogProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const {
    register,
    handleSubmit,
    watch,
    control,
    reset,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AddPartyToMatterInput>({
    resolver: zodResolver(AddPartyToMatterSchema),
    defaultValues: {
      party_id: '',
      side: 'neutral',
      is_primary_contact: false,
      billing_split_percentage: null,
    },
  });

  const selectedSide = watch('side') as MatterPartySide;
  const billingValue = watch('billing_split_percentage');

  // Warn if adding an 'ours' party and SUM would exceed 100
  const showSplitWarning =
    selectedSide === 'ours' &&
    billingValue !== null &&
    billingValue !== undefined &&
    oursSplitTotal + Number(billingValue) > 100;

  // Disable is_primary_contact checkbox if side already has one
  const primaryContactDisabled = existingPrimaryContactSides.includes(selectedSide);

  // -------------------------------------------------------------------------
  // Open/close synchronization
  // -------------------------------------------------------------------------

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) dialog.showModal();
      setTimeout(() => {
        const el = document.getElementById('party-search-input');
        if (el instanceof HTMLElement) el.focus();
      }, 50);
    } else {
      if (dialog.open) dialog.close();
      reset({
        party_id: '',
        side: 'neutral',
        is_primary_contact: false,
        billing_split_percentage: null,
      });
    }
  }, [open, reset]);

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
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        onClose();
      }
    },
    [onClose]
  );

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  const onSubmit = async (data: AddPartyToMatterInput) => {
    if (!data.party_id || data.party_id.trim() === '') {
      setError('party_id', { message: 'Επιλέξτε συμβαλλόμενο από τη λίστα' });
      return;
    }

    const payload = {
      party_id: data.party_id,
      role: data.role,
      side: data.side,
      billing_split_percentage: data.billing_split_percentage ?? null,
      is_primary_contact: data.is_primary_contact ?? false,
    };

    try {
      await clientFetch<{ data: MatterParty }>(
        `/api/v1/matters/${matterId}/parties`,
        { method: 'POST', body: payload }
      );

      onClose();
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 409) {
          setError('party_id', {
            message: 'Ο συμβαλλόμενος υπάρχει ήδη με αυτό το ρόλο στην υπόθεση',
          });
        } else if (err.status === 422) {
          setError('billing_split_percentage', {
            message: 'Το άθροισμα ποσοστών πλευράς "Δική μας" πρέπει να ισούται με 100',
          });
        } else {
          setError('root', { message: err.message });
        }
      } else {
        setError('root', {
          message: 'Σφάλμα επικοινωνίας με τον διακομιστή',
        });
      }
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClick={handleDialogClick}
      aria-labelledby="add-party-matter-title"
      aria-modal="true"
      className={cn(
        'w-full max-w-lg rounded-2xl bg-white p-0 shadow-2xl',
        'backdrop:bg-black/40 backdrop:backdrop-blur-sm',
        'border-0 outline-none',
        'open:flex open:flex-col'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <h2
          id="add-party-matter-title"
          className="text-lg font-semibold text-gray-900"
        >
          Προσθήκη Συμβαλλομένου
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

      {/* Form */}
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="space-y-5 px-6 py-5"
      >
        {/* Root error */}
        {errors.root && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {errors.root.message}
          </div>
        )}

        {/* Party search */}
        <Controller
          name="party_id"
          control={control}
          render={({ field }) => (
            <PartySearch
              value={field.value || null}
              onChange={(id) => {
                field.onChange(id);
                setValue('party_id', id);
              }}
              error={errors.party_id?.message}
            />
          )}
        />

        {/* side radio */}
        <fieldset>
          <legend className="mb-2 block text-sm font-medium text-gray-700">
            Πλευρά{' '}
            <span aria-hidden="true" className="text-red-500">
              *
            </span>
          </legend>
          <div className="flex gap-2" role="radiogroup" aria-label="Πλευρά">
            {MATTER_PARTY_SIDES.map((side) => {
              const checked = selectedSide === side;
              return (
                <label
                  key={side}
                  className={cn(
                    'flex flex-1 cursor-pointer items-center gap-2 rounded-lg border-2 p-3 text-sm transition-colors',
                    'focus-within:ring-2 focus-within:ring-primary-500 focus-within:ring-offset-1',
                    checked
                      ? 'border-primary-500 bg-primary-50 font-medium text-primary-800'
                      : 'border-gray-200 text-gray-700 hover:border-gray-300'
                  )}
                >
                  <input
                    {...register('side')}
                    type="radio"
                    value={side}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500"
                    aria-label={MATTER_PARTY_SIDE_LABELS[side]}
                  />
                  {MATTER_PARTY_SIDE_LABELS[side]}
                </label>
              );
            })}
          </div>
          {errors.side && (
            <p role="alert" className="mt-1 text-sm text-red-600">
              {errors.side.message}
            </p>
          )}
        </fieldset>

        {/* role */}
        <div>
          <label
            htmlFor="matter-party-role"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            Ρόλος{' '}
            <span aria-hidden="true" className="text-red-500">
              *
            </span>
          </label>
          <select
            {...register('role')}
            id="matter-party-role"
            aria-required="true"
            aria-invalid={errors.role ? 'true' : undefined}
            className={cn(
              'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900',
              'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
              'transition-colors',
              errors.role
                ? 'border-red-400 bg-red-50'
                : 'border-gray-300 bg-white'
            )}
          >
            <option value="">— Επιλέξτε ρόλο —</option>
            {MATTER_PARTY_ROLES.map((role) => (
              <option key={role} value={role}>
                {MATTER_PARTY_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          {errors.role && (
            <p role="alert" className="mt-1 text-sm text-red-600">
              {errors.role.message}
            </p>
          )}
        </div>

        {/* billing_split_percentage */}
        <div>
          <label
            htmlFor="billing-split"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            Ποσοστό Χρέωσης{' '}
            <span className="font-normal text-gray-400">(0-100, προαιρετικό)</span>
          </label>
          <div className="relative">
            <input
              {...register('billing_split_percentage', {
                setValueAs: (v: string) =>
                  v === '' || v === null ? null : parseInt(v, 10),
              })}
              id="billing-split"
              type="number"
              min={0}
              max={100}
              step={1}
              inputMode="numeric"
              placeholder="π.χ. 50"
              aria-describedby={
                errors.billing_split_percentage
                  ? 'billing-split-error'
                  : showSplitWarning
                    ? 'billing-split-warn'
                    : 'billing-split-hint'
              }
              aria-invalid={errors.billing_split_percentage ? 'true' : undefined}
              className={cn(
                'block w-full rounded-lg border px-3 py-2.5 pr-10 text-sm text-gray-900 placeholder-gray-400',
                'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
                'transition-colors',
                errors.billing_split_percentage
                  ? 'border-red-400 bg-red-50'
                  : showSplitWarning
                    ? 'border-amber-400 bg-amber-50'
                    : 'border-gray-300 bg-white'
              )}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400"
            >
              %
            </span>
          </div>
          {errors.billing_split_percentage ? (
            <p
              id="billing-split-error"
              role="alert"
              className="mt-1 text-sm text-red-600"
            >
              {errors.billing_split_percentage.message}
            </p>
          ) : showSplitWarning ? (
            <p
              id="billing-split-warn"
              role="alert"
              className="mt-1 text-sm text-amber-700"
            >
              Προσοχή: Το τρέχον άθροισμα πλευράς «Δική μας» ({oursSplitTotal}%
              + {billingValue ?? 0}% = {oursSplitTotal + Number(billingValue ?? 0)}%) υπερβαίνει το
              100%. Ο server θα απορρίψει την εγγραφή.
            </p>
          ) : (
            <p id="billing-split-hint" className="mt-1 text-xs text-gray-400">
              Τρέχον άθροισμα πλευράς «Δική μας»: {oursSplitTotal}%
            </p>
          )}
        </div>

        {/* is_primary_contact */}
        <div className="flex items-start gap-3">
          <input
            {...register('is_primary_contact')}
            id="is-primary-contact"
            type="checkbox"
            disabled={primaryContactDisabled}
            aria-disabled={primaryContactDisabled}
            aria-describedby={
              primaryContactDisabled ? 'primary-contact-hint' : undefined
            }
            className={cn(
              'mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500',
              primaryContactDisabled && 'cursor-not-allowed opacity-40'
            )}
          />
          <div>
            <label
              htmlFor="is-primary-contact"
              className={cn(
                'text-sm text-gray-700 cursor-pointer',
                primaryContactDisabled && 'cursor-not-allowed text-gray-400'
              )}
            >
              Πρωτεύων Επικοινωνός
            </label>
            {primaryContactDisabled && (
              <p id="primary-contact-hint" className="mt-0.5 text-xs text-gray-400">
                Η πλευρά αυτή έχει ήδη πρωτεύοντα επικοινωνό.
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Ακύρωση"
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
            aria-label="Προσθήκη συμβαλλομένου στην υπόθεση"
            className={cn(
              'flex-1 rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-medium text-white',
              'hover:bg-primary-600 transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
              'disabled:cursor-not-allowed disabled:opacity-60'
            )}
          >
            {isSubmitting ? 'Προσθήκη…' : 'Προσθήκη'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
