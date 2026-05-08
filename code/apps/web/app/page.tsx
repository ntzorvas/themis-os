/**
 * / — Dashboard
 *
 * Server Component — fetches counts from the API, shows stat cards and quick links.
 * Requires authentication: calls requireAuth() which redirects to /login if not authenticated.
 *
 * Invariant #10: Greek labels everywhere
 */

import Link from 'next/link';
import type { Metadata } from 'next';
import { requireAuth } from '@/lib/auth';
import { serverFetch } from '@/lib/api-client-server';

export const metadata: Metadata = {
  title: 'Αρχική',
};

// ---------------------------------------------------------------------------
// Data fetching helpers
// ---------------------------------------------------------------------------

async function fetchCount(path: string): Promise<number> {
  try {
    const res = await serverFetch(`${path}?limit=1&offset=0`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return 0;
    const body = (await res.json()) as { meta?: { total?: number } };
    return body.meta?.total ?? 0;
  } catch {
    return 0;
  }
}

async function fetchUserFullName(): Promise<string | null> {
  try {
    const res = await serverFetch('/api/v1/auth/me', {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      user?: { full_name?: string; email?: string };
    };
    return body.user?.full_name ?? body.user?.email ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stat card component (server)
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: number | string;
  href: string;
  description?: string;
}

function StatCard({ label, value, href, description }: StatCardProps) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
      aria-label={`${label}: ${value}`}
    >
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
      {description && (
        <p className="mt-1 text-xs text-gray-400">{description}</p>
      )}
      <p className="mt-3 text-sm font-medium text-primary-600 group-hover:text-primary-700">
        Προβολή →
      </p>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Quick link component
// ---------------------------------------------------------------------------

interface QuickLinkProps {
  href: string;
  label: string;
  description: string;
}

function QuickLink({ href, label, description }: QuickLinkProps) {
  return (
    <Link
      href={href}
      className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium text-gray-900">{label}</p>
        <p className="mt-0.5 text-sm text-gray-500">{description}</p>
      </div>
      <span className="shrink-0 text-gray-400" aria-hidden="true">→</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const productName = process.env['PRODUCT_NAME'] ?? 'ΘΕΜΙΣ OS';

export default async function DashboardPage() {
  // Ensure authenticated — redirects to /login if not
  const session = await requireAuth();
  const displayName = session.payload.name ?? session.payload.email ?? 'Χρήστη';
  const firstName = displayName.split(' ')[0] ?? displayName;

  // Fetch counts in parallel
  const [mattersTotal, partiesTotal, eventsTotal] = await Promise.all([
    fetchCount('/api/v1/matters'),
    fetchCount('/api/v1/parties'),
    fetchCount('/api/v1/calendar/events'),
  ]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Welcome header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Καλωσορίσατε, {firstName}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {productName} — Λογισμικό Διαχείρισης Δικηγορικού Γραφείου
        </p>
      </div>

      {/* Stat cards */}
      <section aria-label="Στατιστικά γραφείου" className="mb-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Επισκόπηση
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Υποθέσεις"
            value={mattersTotal}
            href="/matters"
            description="Σύνολο ενεργών υποθέσεων"
          />
          <StatCard
            label="Πελάτες"
            value={partiesTotal}
            href="/parties"
            description="Συμβαλλόμενα μέρη"
          />
          <StatCard
            label="Εκκρεμείς Προθεσμίες"
            value={eventsTotal}
            href="/calendar"
            description="Γεγονότα ημερολογίου"
          />
          <StatCard
            label="Ωρολόγιο"
            value="—"
            href="/time-entries"
            description="Καταχωρήσεις χρόνου"
          />
        </div>
      </section>

      {/* Quick links */}
      <section aria-label="Γρήγορες συνδέσεις">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Γρήγορη Πρόσβαση
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <QuickLink
            href="/matters"
            label="Υποθέσεις"
            description="Διαχειριστείτε τις υποθέσεις του γραφείου"
          />
          <QuickLink
            href="/parties"
            label="Συμβαλλόμενοι"
            description="Πελάτες, αντίδικοι και τρίτα μέρη"
          />
          <QuickLink
            href="/calendar"
            label="Ημερολόγιο"
            description="Προθεσμίες, δικάσιμοι, συναντήσεις"
          />
          <QuickLink
            href="/time-entries"
            label="Καταχώρηση Χρόνου"
            description="Χρεώσιμες ώρες και χρονομέτρηση"
          />
        </div>
      </section>
    </main>
  );
}
