/**
 * /dashboard — Overview page after login
 * Redirects intent: after successful auth the user lands here.
 *
 * Phase 1: static welcome card with nav links to main sections.
 * Phase 2: will show live KPIs (open matters, upcoming deadlines, etc.)
 */

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Dashboard',
};

const sections = [
  { href: '/matters', label: 'Υποθέσεις', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { href: '/parties', label: 'Επαφές', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  { href: '/calendar', label: 'Ημερολόγιο', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { href: '/time-entries', label: 'Χρονοχρέωση', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  { href: '/invoices', label: 'Τιμολόγια', icon: 'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z' },
  { href: '/expenses', label: 'Δαπάνες', icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2z' },
] as const;

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Επισκόπηση του γραφείου σας
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 transition group-hover:bg-blue-100">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d={s.icon} />
              </svg>
            </div>
            <span className="text-base font-semibold text-gray-900">
              {s.label}
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
