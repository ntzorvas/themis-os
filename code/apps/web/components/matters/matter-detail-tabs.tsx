'use client';

/**
 * MatterDetailTabs — Client Component
 * Tab controller για τη σελίδα λεπτομερειών υπόθεσης.
 *
 * Tabs:
 *   info         → Στοιχεία (additional info grid)
 *   parties      → Συμβαλλόμενοι (MatterPartiesTab)
 *   documents    → Έγγραφα (stub — Day 7)
 *   timeline     → Χρονολόγιο (stub — Day 8)
 *
 * Tab state syncs with URL search param ?tab= via router.push
 */

import { useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { MatterPartiesTab } from './matter-parties-tab';
import { DocumentsPageClient } from '@/app/matters/[id]/documents/page-client';
import { MatterCalendarTab } from './matter-calendar-tab';
import type { Matter, MatterPartiesResponse } from '@/types/matters';
import type { DocumentsListResponse } from '@/types/documents';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'info', label: 'Στοιχεία' },
  { id: 'parties', label: 'Συμβαλλόμενοι' },
  { id: 'documents', label: 'Έγγραφα' },
  { id: 'calendar', label: 'Ημερολόγιο' },
  { id: 'timeline', label: 'Χρονολόγιο' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function isValidTab(value: string): value is TabId {
  return (TABS.map((t) => t.id) as string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MatterDetailTabsProps {
  matterId: string;
  initialTab: string;
  partiesResponse: MatterPartiesResponse;
  documentsResponse: DocumentsListResponse;
  firmSlug: string | null;
  matter: Matter;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MatterDetailTabs({
  matterId,
  initialTab,
  partiesResponse,
  documentsResponse,
  firmSlug,
  matter,
}: MatterDetailTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeTab: TabId = isValidTab(initialTab) ? initialTab : 'info';

  const switchTab = useCallback(
    (tabId: TabId) => {
      const next = new URLSearchParams(searchParams.toString());
      if (tabId === 'info') {
        next.delete('tab');
      } else {
        next.set('tab', tabId);
      }
      router.push(`${pathname}?${next.toString()}`);
    },
    [router, pathname, searchParams]
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Tab list */}
      <div
        role="tablist"
        aria-label="Ενότητες υπόθεσης"
        className="flex border-b border-gray-200"
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              id={`tab-${tab.id}`}
              onClick={() => switchTab(tab.id)}
              className={cn(
                'relative px-5 py-3 text-sm font-medium transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 focus-visible:outline-offset-[-2px]',
                isActive
                  ? 'text-primary-700 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary-500'
                  : 'text-gray-500 hover:text-gray-800'
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab panels */}
      <div className="p-6">
        {/* Στοιχεία */}
        <div
          id="tabpanel-info"
          role="tabpanel"
          aria-labelledby="tab-info"
          hidden={activeTab !== 'info'}
        >
          {activeTab === 'info' && <MatterInfoPanel matter={matter} />}
        </div>

        {/* Συμβαλλόμενοι */}
        <div
          id="tabpanel-parties"
          role="tabpanel"
          aria-labelledby="tab-parties"
          hidden={activeTab !== 'parties'}
        >
          {activeTab === 'parties' && (
            <MatterPartiesTab
              matterId={matterId}
              response={partiesResponse}
            />
          )}
        </div>

        {/* Έγγραφα — Day 7 */}
        <div
          id="tabpanel-documents"
          role="tabpanel"
          aria-labelledby="tab-documents"
          hidden={activeTab !== 'documents'}
        >
          {activeTab === 'documents' && (
            <DocumentsPageClient
              matterId={matterId}
              firmSlug={firmSlug}
              initialResponse={documentsResponse}
            />
          )}
        </div>

        {/* Ημερολόγιο — Day 8 */}
        <div
          id="tabpanel-calendar"
          role="tabpanel"
          aria-labelledby="tab-calendar"
          hidden={activeTab !== 'calendar'}
        >
          {activeTab === 'calendar' && (
            <MatterCalendarTab matterId={matterId} matterTitle={matter.title} />
          )}
        </div>

        {/* Χρονολόγιο — stub Day 8 */}
        <div
          id="tabpanel-timeline"
          role="tabpanel"
          aria-labelledby="tab-timeline"
          hidden={activeTab !== 'timeline'}
        >
          {activeTab === 'timeline' && (
            <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center">
              <h2 className="text-base font-semibold text-gray-700">Χρονολόγιο</h2>
              <p className="mt-2 text-sm text-gray-400">
                Το χρονολόγιο υλοποιείται στο Day 8.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MatterInfoPanel — additional details beyond the summary card
// ---------------------------------------------------------------------------

interface MatterInfoPanelProps {
  matter: Matter;
}

function MatterInfoPanel({ matter }: MatterInfoPanelProps) {
  const fields: { label: string; value: string | null | undefined }[] = [
    { label: 'Μέθοδος Χρέωσης', value: BILLING_METHOD_LABELS[matter.billing_method] },
    {
      label: 'Εκτιμώμενη Αξία',
      value:
        matter.estimated_value_eur_cents !== null
          ? new Intl.NumberFormat('el-GR', {
              style: 'currency',
              currency: 'EUR',
            }).format(matter.estimated_value_eur_cents / 100)
          : null,
    },
    {
      label: 'Υπόλοιπο Προκαταβολής',
      value: new Intl.NumberFormat('el-GR', {
        style: 'currency',
        currency: 'EUR',
      }).format(matter.retainer_balance_eur_cents / 100),
    },
    {
      label: 'Παραγραφή',
      value: matter.statute_of_limitations ?? null,
    },
    {
      label: 'Νομικό Hold',
      value: matter.legal_hold ? 'Ναι' : 'Όχι',
    },
    {
      label: 'Ημερομηνία Δημιουργίας',
      value: new Intl.DateTimeFormat('el-GR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(matter.created_at)),
    },
    {
      label: 'Τελευταία Ενημέρωση',
      value: new Intl.DateTimeFormat('el-GR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(matter.updated_at)),
    },
  ];

  if (matter.tags.length > 0) {
    fields.push({ label: 'Tags', value: matter.tags.join(', ') });
  }

  const hasData = fields.some((f) => f.value !== null && f.value !== undefined);

  if (!hasData) {
    return (
      <p className="text-sm text-gray-400">
        Δεν υπάρχουν επιπλέον στοιχεία για αυτή την υπόθεση.
      </p>
    );
  }

  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map(({ label, value }) => {
        if (value === null || value === undefined) return null;
        return (
          <div key={label}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {label}
            </dt>
            <dd className="mt-1 text-sm text-gray-900">{value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Billing method labels (local — not exported from types to avoid circular)
// ---------------------------------------------------------------------------

const BILLING_METHOD_LABELS: Record<string, string> = {
  hourly: 'Ωριαία Χρέωση',
  fixed: 'Πάγιο Ποσό',
  contingency: 'Επί Επιτυχία',
  retainer: 'Προκαταβολή',
  pro_bono: 'Pro Bono',
};
