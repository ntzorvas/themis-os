'use client';

/**
 * Login form — client component
 *
 * Uses react-hook-form + zod resolver for client-side validation.
 * On submit: calls POST /api/v1/auth/login (proxied to Fastify).
 * On success: stores token via Server Action → httpOnly cookie, then redirects.
 */

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { LoginSchema, type LoginInput } from '@themisos/types';
import { storeSessionAction } from './actions';

interface LoginFormProps {
  /** Firm slug resolved from subdomain — null if not on a firm subdomain */
  firmSlug: string | null;
  /** Where to redirect after successful login */
  callbackUrl: string;
}

export default function LoginForm({ firmSlug, callbackUrl }: LoginFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (data: LoginInput) => {
    setServerError(null);
    setIsSubmitting(true);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Pass firm slug via header if available (complements subdomain resolution)
      if (firmSlug !== null) {
        headers['x-firm-slug'] = firmSlug;
      }

      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ email: data.email, password: data.password }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: { code?: string; message?: string } };
        const code = body.error?.code ?? 'UNKNOWN';
        const message = body.error?.message;

        if (code === 'FIRM_REQUIRED') {
          setServerError(
            'Δεν ήταν δυνατός ο προσδιορισμός του γραφείου. Χρησιμοποιήστε τον σύνδεσμο πρόσβασης που λάβατε.'
          );
        } else if (code === 'FIRM_SUSPENDED') {
          setServerError(
            'Ο λογαριασμός του γραφείου έχει ανασταλεί. Επικοινωνήστε με την υποστήριξη.'
          );
        } else if (response.status === 429) {
          setServerError(
            'Πολλές αποτυχημένες προσπάθειες. Δοκιμάστε ξανά σε λίγα λεπτά.'
          );
        } else {
          setServerError(
            message ?? 'Λανθασμένα στοιχεία σύνδεσης. Ελέγξτε το email και τον κωδικό σας.'
          );
        }
        return;
      }

      const body = (await response.json()) as { token?: string };
      const token = body.token;

      if (typeof token !== 'string' || token.length === 0) {
        setServerError('Μη αναμενόμενη απάντηση από τον διακομιστή. Δοκιμάστε ξανά.');
        return;
      }

      // Store token in httpOnly cookie via Server Action
      await storeSessionAction(token);

      // Redirect to intended destination
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setServerError('Σφάλμα δικτύου. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      {/* Email */}
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-700">
          Διεύθυνση email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          {...register('email')}
          placeholder="example@dikigoros.gr"
          className={[
            'w-full rounded-lg border px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400',
            'outline-none transition focus:ring-2 focus:ring-blue-500',
            errors.email
              ? 'border-red-400 focus:ring-red-400'
              : 'border-gray-300 focus:border-blue-500',
          ].join(' ')}
          aria-invalid={errors.email !== undefined ? 'true' : 'false'}
          aria-describedby={errors.email !== undefined ? 'email-error' : undefined}
        />
        {errors.email !== undefined && (
          <p id="email-error" className="mt-1.5 text-xs text-red-600" role="alert">
            {errors.email.message}
          </p>
        )}
      </div>

      {/* Password */}
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-gray-700">
          Κωδικός πρόσβασης
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          {...register('password')}
          placeholder="••••••••"
          className={[
            'w-full rounded-lg border px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400',
            'outline-none transition focus:ring-2 focus:ring-blue-500',
            errors.password
              ? 'border-red-400 focus:ring-red-400'
              : 'border-gray-300 focus:border-blue-500',
          ].join(' ')}
          aria-invalid={errors.password !== undefined ? 'true' : 'false'}
          aria-describedby={errors.password !== undefined ? 'password-error' : undefined}
        />
        {errors.password !== undefined && (
          <p id="password-error" className="mt-1.5 text-xs text-red-600" role="alert">
            {errors.password.message}
          </p>
        )}
      </div>

      {/* Server error */}
      {serverError !== null && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {serverError}
        </div>
      )}

      {/* Submit */}
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
        {isSubmitting ? 'Σύνδεση…' : 'Σύνδεση'}
      </button>
    </form>
  );
}
