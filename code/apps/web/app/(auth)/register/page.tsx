/**
 * Register firm page — multi-step firm signup
 * Step 1: Firm details (legalName, slug, afm, tier, billingEmail)
 * Step 2: Owner details (ownerEmail, ownerPassword, ownerFullName, ownerBarId)
 */

import type { Metadata } from 'next';
import RegisterForm from './register-form';

export const metadata: Metadata = {
  title: 'Εγγραφή Γραφείου',
};

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Brand */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-blue-900">
            <span className="text-xl font-bold text-white">Θ</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">ΘΕΜΙΣ OS</h1>
          <p className="mt-1 text-sm text-gray-500">Εγγραφή δικηγορικού γραφείου</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <RegisterForm />
        </div>

        <p className="mt-6 text-center text-sm text-gray-500">
          Έχετε ήδη λογαριασμό;{' '}
          <a href="/login" className="font-medium text-blue-700 hover:underline">
            Σύνδεση
          </a>
        </p>
      </div>
    </div>
  );
}
