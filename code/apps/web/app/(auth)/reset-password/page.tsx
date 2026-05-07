'use client';

/**
 * Reset password page.
 * Reads `token` and `firm` from URL search params.
 * Submits to POST /api/v1/auth/reset-password.
 */

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSearchParams, useRouter } from 'next/navigation';
import { ResetPasswordSchema, type ResetPasswordInput } from '@themisos/types';

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const tokenFromUrl = searchParams.get('token') ?? '';
  const firmSlugFromUrl = searchParams.get('firm') ?? '';

  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(ResetPasswordSchema),
    defaultValues: {
      token: tokenFromUrl,
      newPassword: '',
      firmSlug: firmSlugFromUrl,
    },
  });

  // Guard: if no token or firm in URL, show error
  if (tokenFromUrl.length === 0 || firmSlugFromUrl.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-8 shadow-sm text-center">
          <p className="text-sm text-red-700">
            Μη έγκυρος σύνδεσμος επαναφοράς. Ζητήστε νέο email επαναφοράς.
          </p>
          <a
            href="/forgot-password"
            className="mt-4 inline-block text-sm font-medium text-blue-700 hover:underline"
          >
            Επαναφορά κωδικού
          </a>
        </div>
      </div>
    );
  }

  const onSubmit = async (data: ResetPasswordInput) => {
    setServerError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: { code?: string; message?: string } };
        const code = body.error?.code ?? 'UNKNOWN';

        if (code === 'TOKEN_EXPIRED') {
          setServerError('Ο σύνδεσμος επαναφοράς έχει λήξει. Ζητήστε νέο email.');
        } else if (code === 'TOKEN_ALREADY_USED') {
          setServerError('Αυτός ο σύνδεσμος έχει ήδη χρησιμοποιηθεί. Ζητήστε νέο email.');
        } else {
          setServerError(
            body.error?.message ?? 'Αποτυχία επαναφοράς κωδικού. Δοκιμάστε ξανά.'
          );
        }
        return;
      }

      setSuccess(true);
      setTimeout(() => router.push('/login'), 3000);
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
          <h1 className="text-2xl font-bold text-gray-900">Νέος κωδικός</h1>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          {success ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <span className="text-xl text-green-700">✓</span>
              </div>
              <p className="text-sm text-gray-700">
                Ο κωδικός σας άλλαξε επιτυχώς. Ανακατεύθυνση στη σύνδεση…
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
              {/* Hidden fields for token + firmSlug — included in form data */}
              <input type="hidden" {...register('token')} />
              <input type="hidden" {...register('firmSlug')} />

              <p className="text-sm text-gray-600">
                Εισάγετε τον νέο σας κωδικό. Πρέπει να έχει τουλάχιστον 12 χαρακτήρες και
                να περιλαμβάνει γράμματα και αριθμούς.
              </p>

              {/* New password */}
              <div>
                <label
                  htmlFor="newPassword"
                  className="mb-1.5 block text-sm font-medium text-gray-700"
                >
                  Νέος κωδικός πρόσβασης
                </label>
                <input
                  id="newPassword"
                  type="password"
                  autoFocus
                  autoComplete="new-password"
                  {...register('newPassword')}
                  placeholder="Τουλάχιστον 12 χαρακτήρες"
                  className={inputCls(errors.newPassword !== undefined)}
                />
                {errors.newPassword !== undefined && (
                  <p className="mt-1.5 text-xs text-red-600" role="alert">
                    {errors.newPassword.message}
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
                {isSubmitting ? 'Αποθήκευση…' : 'Αποθήκευση νέου κωδικού'}
              </button>
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
