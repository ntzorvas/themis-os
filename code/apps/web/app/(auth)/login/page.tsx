/**
 * Login page — server component shell
 * Renders LoginForm (client component) inside a centered card.
 * Firm context resolved from subdomain or query param.
 */

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getSession } from '../../../lib/auth';
import { redirect } from 'next/navigation';
import LoginForm from './login-form';

export const metadata: Metadata = {
  title: 'Σύνδεση',
};

interface LoginPageProps {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  // If already authenticated, redirect to dashboard
  const session = await getSession();
  if (session !== null) {
    redirect('/dashboard');
  }

  const headerStore = await headers();
  const firmSlug = headerStore.get('x-firm-slug') ?? null;

  const resolvedParams = await searchParams;
  const callbackUrl = resolvedParams.callbackUrl ?? '/dashboard';

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo / brand */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-blue-900">
            <span className="text-xl font-bold text-white">Θ</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">ΘΕΜΙΣ OS</h1>
          {firmSlug !== null && (
            <p className="mt-1 text-sm text-gray-500">{firmSlug}</p>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <h2 className="mb-6 text-xl font-semibold text-gray-900">Σύνδεση</h2>
          <LoginForm firmSlug={firmSlug} callbackUrl={callbackUrl} />
        </div>

        <p className="mt-6 text-center text-sm text-gray-500">
          Δεν έχετε λογαριασμό;{' '}
          <a href="/register" className="font-medium text-blue-700 hover:underline">
            Εγγραφή γραφείου
          </a>
        </p>

        <p className="mt-2 text-center text-sm text-gray-500">
          <a href="/forgot-password" className="text-gray-400 hover:text-gray-700 hover:underline">
            Ξεχάσατε τον κωδικό σας;
          </a>
        </p>
      </div>
    </div>
  );
}
