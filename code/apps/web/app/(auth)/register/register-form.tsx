'use client';

/**
 * Multi-step firm registration form.
 *
 * Step 1 — Firm details: legalName, slug, afm, tier, billingEmail
 * Step 2 — Owner details: ownerEmail, ownerPassword, ownerFullName, ownerBarId
 *
 * On final submit: calls POST /api/v1/auth/register-firm
 * On success: redirects to /login with success message.
 */

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { RegisterFirmSchema, type RegisterFirmInput } from '@themisos/types';

// Tier options in Greek
const TIER_OPTIONS = [
  { value: 'starter', label: 'Starter — €19/μήνα (1-3 χρήστες)' },
  { value: 'professional', label: 'Professional — €39/μήνα (έως 15 χρήστες)' },
  { value: 'firm', label: 'Firm — €59/μήνα (αποκλειστική βάση)' },
  { value: 'enterprise', label: 'Enterprise — €79+/μήνα (BYOK)' },
] as const;

export default function RegisterForm() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successFirmSlug, setSuccessFirmSlug] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    trigger,
    getValues,
    formState: { errors },
  } = useForm<RegisterFirmInput>({
    resolver: zodResolver(RegisterFirmSchema),
    defaultValues: {
      legalName: '',
      slug: '',
      afm: '',
      tier: 'professional',
      billingEmail: '',
      ownerEmail: '',
      ownerPassword: '',
      ownerFullName: '',
      ownerBarId: '',
    },
    mode: 'onBlur',
  });

  // Step 1 field names
  const step1Fields: (keyof RegisterFirmInput)[] = [
    'legalName',
    'slug',
    'afm',
    'tier',
    'billingEmail',
  ];

  const goToStep2 = async () => {
    const valid = await trigger(step1Fields);
    if (valid) setStep(2);
  };

  const onSubmit = async (data: RegisterFirmInput) => {
    setServerError(null);
    setIsSubmitting(true);

    try {
      const payload: RegisterFirmInput = {
        ...data,
        // Clean optional empty strings
        ownerBarId: data.ownerBarId?.trim() === '' ? undefined : data.ownerBarId,
      };

      const response = await fetch('/api/v1/auth/register-firm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: { code?: string; message?: string } };
        const code = body.error?.code ?? 'UNKNOWN';

        if (code === 'SLUG_TAKEN') {
          setStep(1);
          setServerError(
            `Το αναγνωριστικό "${data.slug}" χρησιμοποιείται ήδη. Επιλέξτε διαφορετικό.`
          );
        } else if (code === 'VALIDATION_ERROR') {
          setServerError(body.error?.message ?? 'Σφάλμα επικύρωσης. Ελέγξτε τα στοιχεία σας.');
        } else {
          setServerError(
            body.error?.message ?? 'Αποτυχία εγγραφής. Δοκιμάστε ξανά σε λίγα λεπτά.'
          );
        }
        return;
      }

      setSuccessFirmSlug(data.slug);

      // Redirect to login after 3 seconds
      setTimeout(() => {
        router.push('/login');
      }, 3000);
    } catch {
      setServerError('Σφάλμα δικτύου. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Success state
  if (successFirmSlug !== null) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <span className="text-xl text-green-700">✓</span>
        </div>
        <h2 className="mb-2 text-xl font-semibold text-gray-900">
          Το γραφείο δημιουργήθηκε!
        </h2>
        <p className="text-sm text-gray-600">
          Ανακατεύθυνση στη σελίδα σύνδεσης…
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      {/* Step indicator */}
      <div className="mb-6 flex items-center gap-2">
        <div
          className={[
            'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
            step >= 1 ? 'bg-blue-700 text-white' : 'bg-gray-200 text-gray-500',
          ].join(' ')}
        >
          1
        </div>
        <div className="h-px flex-1 bg-gray-200" />
        <div
          className={[
            'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
            step === 2 ? 'bg-blue-700 text-white' : 'bg-gray-200 text-gray-500',
          ].join(' ')}
        >
          2
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* STEP 1 — Firm details */}
      {/* ------------------------------------------------------------------ */}
      {step === 1 && (
        <div className="space-y-5">
          <h2 className="text-lg font-semibold text-gray-900">Στοιχεία γραφείου</h2>

          {/* Legal name */}
          <div>
            <label htmlFor="legalName" className="mb-1.5 block text-sm font-medium text-gray-700">
              Επωνυμία γραφείου
            </label>
            <input
              id="legalName"
              type="text"
              autoFocus
              {...register('legalName')}
              placeholder="π.χ. Παπαδόπουλος & Συνεργάτες"
              className={inputCls(errors.legalName !== undefined)}
            />
            <FieldError message={errors.legalName?.message} />
          </div>

          {/* Slug */}
          <div>
            <label htmlFor="slug" className="mb-1.5 block text-sm font-medium text-gray-700">
              Αναγνωριστικό (subdomain)
            </label>
            <div className="flex items-center">
              <input
                id="slug"
                type="text"
                {...register('slug')}
                placeholder="papadopoulos-law"
                className={[inputCls(errors.slug !== undefined), 'rounded-r-none'].join(' ')}
              />
              <span className="inline-flex items-center rounded-r-lg border border-l-0 border-gray-300 bg-gray-50 px-3 py-2.5 text-sm text-gray-500">
                .themisos.gr
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Μόνο πεζά γράμματα, αριθμοί και παύλες. Δεν μπορεί να αλλάξει μετά την εγγραφή.
            </p>
            <FieldError message={errors.slug?.message} />
          </div>

          {/* AFM */}
          <div>
            <label htmlFor="afm" className="mb-1.5 block text-sm font-medium text-gray-700">
              ΑΦΜ γραφείου
            </label>
            <input
              id="afm"
              type="text"
              inputMode="numeric"
              maxLength={9}
              {...register('afm')}
              placeholder="123456789"
              className={inputCls(errors.afm !== undefined)}
            />
            <FieldError message={errors.afm?.message} />
          </div>

          {/* Tier */}
          <div>
            <label htmlFor="tier" className="mb-1.5 block text-sm font-medium text-gray-700">
              Πλάνο συνδρομής
            </label>
            <select
              id="tier"
              {...register('tier')}
              className={[inputCls(errors.tier !== undefined), 'bg-white'].join(' ')}
            >
              {TIER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <FieldError message={errors.tier?.message} />
          </div>

          {/* Billing email */}
          <div>
            <label
              htmlFor="billingEmail"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Email χρέωσης
            </label>
            <input
              id="billingEmail"
              type="email"
              autoComplete="email"
              {...register('billingEmail')}
              placeholder="billing@papadopoulos-law.gr"
              className={inputCls(errors.billingEmail !== undefined)}
            />
            <FieldError message={errors.billingEmail?.message} />
          </div>

          {serverError !== null && <ServerError message={serverError} />}

          <button
            type="button"
            onClick={goToStep2}
            className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 active:bg-blue-900"
          >
            Επόμενο →
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* STEP 2 — Owner details */}
      {/* ------------------------------------------------------------------ */}
      {step === 2 && (
        <div className="space-y-5">
          <h2 className="text-lg font-semibold text-gray-900">Στοιχεία ιδιοκτήτη</h2>
          <p className="text-sm text-gray-500">
            Γραφείο:{' '}
            <span className="font-medium text-gray-800">{getValues('legalName')}</span>
          </p>

          {/* Owner full name */}
          <div>
            <label
              htmlFor="ownerFullName"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Πλήρες ονοματεπώνυμο
            </label>
            <input
              id="ownerFullName"
              type="text"
              autoFocus
              autoComplete="name"
              {...register('ownerFullName')}
              placeholder="π.χ. Νικόλαος Παπαδόπουλος"
              className={inputCls(errors.ownerFullName !== undefined)}
            />
            <FieldError message={errors.ownerFullName?.message} />
          </div>

          {/* Owner email */}
          <div>
            <label
              htmlFor="ownerEmail"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Email σύνδεσης
            </label>
            <input
              id="ownerEmail"
              type="email"
              autoComplete="email"
              {...register('ownerEmail')}
              placeholder="nikos@papadopoulos-law.gr"
              className={inputCls(errors.ownerEmail !== undefined)}
            />
            <FieldError message={errors.ownerEmail?.message} />
          </div>

          {/* Owner password */}
          <div>
            <label
              htmlFor="ownerPassword"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Κωδικός πρόσβασης
            </label>
            <input
              id="ownerPassword"
              type="password"
              autoComplete="new-password"
              {...register('ownerPassword')}
              placeholder="Τουλάχιστον 12 χαρακτήρες"
              className={inputCls(errors.ownerPassword !== undefined)}
            />
            <p className="mt-1 text-xs text-gray-400">
              Τουλάχιστον 12 χαρακτήρες, με γράμματα και αριθμούς.
            </p>
            <FieldError message={errors.ownerPassword?.message} />
          </div>

          {/* Bar ID (optional) */}
          <div>
            <label
              htmlFor="ownerBarId"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Αριθμός Μητρώου ΔΣ{' '}
              <span className="text-xs font-normal text-gray-400">(προαιρετικό)</span>
            </label>
            <input
              id="ownerBarId"
              type="text"
              {...register('ownerBarId')}
              placeholder="π.χ. ΑΜ 12345 ΔΣΑ"
              className={inputCls(errors.ownerBarId !== undefined)}
            />
            <FieldError message={errors.ownerBarId?.message} />
          </div>

          {serverError !== null && <ServerError message={serverError} />}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              ← Πίσω
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={[
                'flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition',
                isSubmitting
                  ? 'cursor-not-allowed bg-blue-400'
                  : 'bg-blue-700 hover:bg-blue-800 active:bg-blue-900',
              ].join(' ')}
            >
              {isSubmitting ? 'Εγγραφή…' : 'Ολοκλήρωση εγγραφής'}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Local sub-components
// ---------------------------------------------------------------------------

function inputCls(hasError: boolean): string {
  return [
    'w-full rounded-lg border px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400',
    'outline-none transition focus:ring-2',
    hasError
      ? 'border-red-400 focus:ring-red-400'
      : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500',
  ].join(' ');
}

function FieldError({ message }: { message: string | undefined }) {
  if (message === undefined) return null;
  return (
    <p className="mt-1.5 text-xs text-red-600" role="alert">
      {message}
    </p>
  );
}

function ServerError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {message}
    </div>
  );
}
