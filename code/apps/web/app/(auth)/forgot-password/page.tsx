'use client';

/**
 * Forgot password page.
 * Submits email + firmSlug to POST /api/v1/auth/forgot-password.
 * Always shows generic success message to prevent email enumeration.
 */

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ForgotPasswordSchema, type ForgotPasswordInput } from '@themisos/types';

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(ForgotPasswordSchema),
    defaultValues: { email: '', firmSlug: '' },
  });

  const onSubmit = async (data: ForgotPasswordInput) => {
    setServerError(null);
    setIsSubmitting(true);
    try {
      await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      // Always show success regardless of response — server mirrors this behavior
      setSubmitted(true);
    } catch {
      setServerError('Σφάλμα δικτύου. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-blue-900">
            <span className="text-xl font-bold text-white">Θ</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Επαναφορά κωδικού</h1>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          {submitted ? (
            <div className="text-center">
              <p className="text-sm text-gray-700">
                Αν ο λογαριασμός υπάρχει, στείλαμε email επαναφοράς. Ελέγξτε τα εισερχόμενά
                σας (και το φάκελο spam).
              </p>
              <a
                href="/login"
                className="mt-6 inline-block text-sm font-medium text-blue-700 hover:underline"
              >
                ← Επιστροφή στη σύνδεση
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
              <p className="text-sm text-gray-600">
                Εισάγετε το email και το αναγνωριστικό του γραφείου σας. Θα σας στείλουμε
                σύνδεσμο επαναφοράς κωδικού.
              </p>

              {/* Email */}
              <div>
                <label
                  htmlFor="email"
                  className="mb-1.5 block text-sm font-medium text-gray-700"
                >
                  Διεύθυνση email
                </label>
                <input
                  id="email"
                  type="email"
                  autoFocus
                  autoComplete="email"
                  {...register('email')}
                  placeholder="you@example.gr"
                  className={inputCls(errors.email !== undefined)}
                />
                {errors.email !== undefined && (
                  <p className="mt-1.5 text-xs text-red-600" role="alert">
                    {errors.email.message}
                  </p>
                )}
              </div>

              {/* Firm slug */}
              <div>
                <label
                  htmlFor="firmSlug"
                  className="mb-1.5 block text-sm font-medium text-gray-700"
                >
                  Αναγνωριστικό γραφείου
                </label>
                <input
                  id="firmSlug"
                  type="text"
                  {...register('firmSlug')}
                  placeholder="papadopoulos-law"
                  className={inputCls(errors.firmSlug !== undefined)}
                />
                {errors.firmSlug !== undefined && (
                  <p className="mt-1.5 text-xs text-red-600" role="alert">
                    {errors.firmSlug.message}
                  </p>
                )}
              </div>

              {serverError !== null && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                >
                  {serverError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className={[
                  'w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition',
                  isSubmitting
                    ? 'cursor-not-allowed bg-blue-400'
                    : 'bg-blue-700 hover:bg-blue-800 active:bg-blue-900',
                ].join(' ')}
              >
                {isSubmitting ? 'Αποστολή…' : 'Αποστολή email επαναφοράς'}
              </button>

              <p className="text-center text-sm text-gray-400">
                <a href="/login" className="hover:text-gray-700 hover:underline">
                  ← Επιστροφή στη σύνδεση
                </a>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function inputCls(hasError: boolean): string {
  return [
    'w-full rounded-lg border px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400',
    'outline-none transition focus:ring-2',
    hasError
      ? 'border-red-400 focus:ring-red-400'
      : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500',
  ].join(' ');
}
