/**
 * /parties/[id] — Stub σελίδα λεπτομερειών Συμβαλλομένου
 * Πλήρης υλοποίηση: Day 6
 *
 * Phase 1 — εμφανίζει βασικά στοιχεία και placeholder για τις υποθέσεις.
 */

import { headers } from 'next/headers';
import Link from 'next/link';
import type { Metadata } from 'next';
import {
  PARTY_TYPE_LABELS,
  PARTY_ROLE_LABELS,
  PARTY_ROLE_COLORS,
  type Party,
  type PartyRole,
} from '@/types/parties';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PageProps {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(isoString: string): string {
  try {
    return new Intl.DateTimeFormat('el-GR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchParty(
  id: string,
  firmSlug: string | null
): Promise<Party | null> {
  const apiUrl =
    process.env['INTERNAL_API_URL'] ?? 'http://localhost:4000';

  const requestHeaders = new Headers();
  requestHeaders.set('Content-Type', 'application/json');
  if (firmSlug !== null) {
    requestHeaders.set('x-firm-slug', firmSlug);
  }

  try {
    const response = await fetch(`${apiUrl}/api/v1/parties/${id}`, {
      headers: requestHeaders,
      next: { revalidate: 60 },
    });

    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`API responded ${response.status}`);

    const json = (await response.json()) as { data: Party };
    return json.data;
  } catch {
    // Fallback mock — αφαιρείται Day 6
    return {
      id,
      display_name: 'Συμβαλλόμενος (mock)',
      party_type: 'natural',
      afm: null,
      is_attorney: false,
      roles: ['client'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const requestHeaders = await headers();
  const firmSlug = requestHeaders.get('x-firm-slug');
  const party = await fetchParty(id, firmSlug);

  return {
    title: party?.display_name ?? 'Συμβαλλόμενος',
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function PartyDetailPage({ params }: PageProps) {
  const { id } = await params;
  const requestHeaders = await headers();
  const firmSlug = requestHeaders.get('x-firm-slug');

  const party = await fetchParty(id, firmSlug);

  if (party === null) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="rounded-xl border border-red-100 bg-red-50 p-8 text-center">
          <h1 className="text-xl font-semibold text-red-800">
            Συμβαλλόμενος δεν βρέθηκε
          </h1>
          <p className="mt-2 text-sm text-red-600">
            Το αναγνωριστικό <code className="font-mono">{id}</code> δεν
            αντιστοιχεί σε κανέναν συμβαλλόμενο.
          </p>
          <Link
            href="/parties"
            className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:underline"
            aria-label="Επιστροφή στη λίστα συμβαλλομένων"
          >
            ← Επιστροφή στη λίστα
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex items-center gap-2 text-sm text-gray-500">
          <li>
            <Link
              href="/parties"
              className="hover:text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 rounded"
              aria-label="Συμβαλλόμενοι"
            >
              Συμβαλλόμενοι
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li className="font-medium text-gray-900" aria-current="page">
            {party.display_name}
          </li>
        </ol>
      </nav>

      <div className="space-y-6">
        {/* Summary card */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {party.display_name}
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                {PARTY_TYPE_LABELS[party.party_type]}
                {party.is_attorney && (
                  <span className="ml-2 rounded bg-purple-50 px-1.5 py-0.5 text-xs font-medium text-purple-700">
                    Δικηγόρος
                  </span>
                )}
              </p>
            </div>

            {/* TODO Day 6: Edit button */}
            <button
              type="button"
              disabled
              title="Διαθέσιμο Day 6"
              aria-label="Επεξεργασία (διαθέσιμο Day 6)"
              className="cursor-not-allowed rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-400"
            >
              Επεξεργασία
            </button>
          </div>

          {/* Details grid */}
          <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                ΑΦΜ
              </dt>
              <dd className="mt-1 font-mono text-sm text-gray-900">
                {party.afm ?? <span className="text-gray-300">—</span>}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Ρόλοι
              </dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {party.roles.length === 0 ? (
                  <span className="text-sm text-gray-300">—</span>
                ) : (
                  party.roles.map((role: PartyRole) => (
                    <span
                      key={role}
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PARTY_ROLE_COLORS[role]}`}
                    >
                      {PARTY_ROLE_LABELS[role]}
                    </span>
                  ))
                )}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Εγγραφή
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {formatDate(party.created_at)}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Τελευταία ενημέρωση
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {formatDate(party.updated_at)}
              </dd>
            </div>
          </dl>
        </div>

        {/* Placeholder — υποθέσεις Day 6 */}
        <div className="rounded-xl border border-dashed border-gray-200 bg-white p-8 text-center">
          <h2 className="text-base font-semibold text-gray-700">Υποθέσεις</h2>
          <p className="mt-2 text-sm text-gray-400">
            Η λίστα υποθέσεων αυτού του συμβαλλομένου υλοποιείται στο Day 6.
          </p>
        </div>
      </div>
    </main>
  );
}
