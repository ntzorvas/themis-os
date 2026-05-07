'use client';

/**
 * NewPartyDialog — Client Component
 * Modal για δημιουργία νέου συμβαλλομένου.
 *
 * - party_type radio (Φυσικό/Νομικό)
 * - display_name (required)
 * - AFM (optional, client-side checksum validation via @themisos/greek-utils)
 * - initial_role (client/counterparty/attorney/witness/expert/counsel)
 * - is_attorney toggle
 * - Greek error messages
 * - a11y: focus trap, ARIA dialog, keyboard nav
 *
 * POST → /api/v1/parties (proxied via Next.js rewrites to Fastify)
 */

import { useEffect, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { validateAFM } from '@themisos/greek-utils';
import {
  CreatePartySchema,
  PARTY_ROLES,
  PARTY_ROLE_LABELS,
  PARTY_TYPE_LABELS,
  type CreatePartyInput,
  type PartyType,
} from '@/types/parties';
import { clientFetch, ApiClientError } from '@/lib/api-client';
import type { Party } from '@/types/parties';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NewPartyDialogProps {
  open: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NewPartyDialog({ open, onClose }: NewPartyDialogProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstInputId = 'display_name';

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreatePartyInput>({
    resolver: zodResolver(CreatePartySchema),
    defaultValues: {
      party_type: 'natural',
      is_attorney: false,
    },
  });

  const partyType = watch('party_type') as PartyType;

  // -------------------------------------------------------------------------
  // Open/close synchronization
  // -------------------------------------------------------------------------

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
      // Focus first focusable element
      setTimeout(() => {
        const el = document.getElementById(firstInputId);
        if (el instanceof HTMLElement) el.focus();
      }, 50);
    } else {
      if (dialog.open) {
        dialog.close();
      }
      reset();
    }
  }, [open, reset]);

  // Close on <dialog> native close event (Escape key)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  // Close on backdrop click
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

  const onSubmit = async (data: CreatePartyInput) => {
    // Client-side AFM validation — επιπλέον του Zod (checksum)
    if (
      data.afm !== undefined &&
      data.afm.length > 0 &&
      !validateAFM(data.afm)
    ) {
      setError('afm', {
        message: 'Μη έγκυρο ΑΦΜ — λανθασμένο checksum',
      });
      return;
    }

    // Strip empty AFM
    const payload: CreatePartyInput = {
      ...data,
      afm: data.afm && data.afm.trim().length > 0 ? data.afm.trim() : undefined,
    };

    try {
      await clientFetch<{ data: Party }>('/api/v1/parties', {
        method: 'POST',
        body: payload,
      });

      onClose();
      // Refresh RSC page to include new party
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 409) {
          setError('afm', {
            message: 'ΑΦΜ υπάρχει ήδη στο σύστημα',
          });
        } else {
          setError('root', {
            message: err.message,
          });
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
      aria-labelledby="new-party-title"
      aria-modal="true"
      className={cn(
        'w-full max-w-lg rounded-2xl bg-white p-0 shadow-2xl',
        'backdrop:bg-black/40 backdrop:backdrop-blur-sm',
        // Remove default dialog styles
        'border-0 outline-none',
        'open:flex open:flex-col'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <h2
          id="new-party-title"
          className="text-lg font-semibold text-gray-900"
        >
          Νέο Συμβαλλόμενο
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

        {/* party_type radio */}
        <fieldset>
          <legend className="mb-2 block text-sm font-medium text-gray-700">
            Τύπος Προσώπου <span aria-hidden="true" className="text-red-500">*</span>
          </legend>
          <div className="flex gap-4" role="radiogroup" aria-label="Τύπος Προσώπου">
            {(['natural', 'legal'] as PartyType[]).map((pt) => (
              <label
                key={pt}
                className={cn(
                  'flex flex-1 cursor-pointer items-center gap-3 rounded-lg border-2 p-3 transition-colors',
                  'focus-within:ring-2 focus-within:ring-primary-500 focus-within:ring-offset-1',
                  partyType === pt
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <input
                  {...register('party_type')}
                  type="radio"
                  value={pt}
                  aria-label={PARTY_TYPE_LABELS[pt]}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm font-medium text-gray-900">
                  {PARTY_TYPE_LABELS[pt]}
                </span>
              </label>
            ))}
          </div>
          {errors.party_type && (
            <p role="alert" className="mt-1 text-sm text-red-600">
              {errors.party_type.message}
            </p>
          )}
        </fieldset>

        {/* display_name */}
        <div>
          <label
            htmlFor="display_name"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            Ονομασία <span aria-hidden="true" className="text-red-500">*</span>
          </label>
          <input
            {...register('display_name')}
            id="display_name"
            type="text"
            autoComplete="name"
            placeholder={
              partyType === 'natural'
                ? 'π.χ. Νικόλαος Παπαδόπουλος'
                : 'π.χ. ΑΛΦΑ ΑΕ'
            }
            aria-required="true"
            aria-invalid={errors.display_name ? 'true' : undefined}
            aria-describedby={
              errors.display_name ? 'display_name-error' : undefined
            }
            className={cn(
              'block w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400',
              'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
              'transition-colors',
              errors.display_name
                ? 'border-red-400 bg-red-50'
                : 'border-gray-300 bg-white'
            )}
          />
          {errors.display_name && (
            <p
              id="display_name-error"
              role="alert"
              className="mt-1 text-sm text-red-600"
            >
              {errors.display_name.message}
            </p>
          )}
        </div>

        {/* AFM */}
        <div>
          <label
            htmlFor="afm"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            ΑΦΜ{' '}
            <span className="font-normal text-gray-400">(προαιρετικό)</span>
          </label>
          <input
            {...register('afm')}
            id="afm"
            type="text"
            inputMode="numeric"
            maxLength={9}
            placeholder="123456789"
            aria-describedby={
              errors.afm ? 'afm-error' : 'afm-hint'
            }
            aria-invalid={errors.afm ? 'true' : undefined}
            className={cn(
              'block w-full rounded-lg border px-3 py-2.5 font-mono text-sm text-gray-900 placeholder-gray-400',
              'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
              'transition-colors',
              errors.afm
                ? 'border-red-400 bg-red-50'
                : 'border-gray-300 bg-white'
            )}
          />
          {errors.afm ? (
            <p id="afm-error" role="alert" className="mt-1 text-sm text-red-600">
              {errors.afm.message}
            </p>
          ) : (
            <p id="afm-hint" className="mt-1 text-xs text-gray-400">
              9 ψηφία — επαλήθευση checksum ΑΑΔΕ
            </p>
          )}
        </div>

        {/* initial_role */}
        <div>
          <label
            htmlFor="initial_role"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            Αρχικός Ρόλος{' '}
            <span className="font-normal text-gray-400">(προαιρετικό)</span>
          </label>
          <select
            {...register('initial_role')}
            id="initial_role"
            aria-label="Αρχικός ρόλος συμβαλλομένου"
            className={cn(
              'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900',
              'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
              'transition-colors'
            )}
          >
            <option value="">— Χωρίς ρόλο —</option>
            {PARTY_ROLES.map((role: typeof PARTY_ROLES[number]) => (
              <option key={role} value={role}>
                {PARTY_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </div>

        {/* is_attorney toggle */}
        <div className="flex items-center gap-3">
          <input
            {...register('is_attorney')}
            id="is_attorney"
            type="checkbox"
            aria-label="Είναι εγγεγραμμένος δικηγόρος"
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <label
            htmlFor="is_attorney"
            className="text-sm text-gray-700 cursor-pointer"
          >
            Εγγεγραμμένος Δικηγόρος
          </label>
        </div>

        {/* Actions */}
        <div className="flex gap-3 border-t border-gray-100 pt-4">
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
            aria-label="Αποθήκευση νέου συμβαλλομένου"
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
