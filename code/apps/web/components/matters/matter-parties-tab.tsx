'use client';

/**
 * MatterPartiesTab — Client Component
 * Εμφανίζει τους συμβαλλομένους μιας υπόθεσης σε ομάδες κατά πλευρά.
 * Περιλαμβάνει:
 * - "Προσθήκη Συμβαλλομένου" button → AddPartyToMatterDialog
 * - Editing billing_split_percentage per row (inline PATCH)
 * - Remove party (DELETE with confirm)
 * - Visual group by side (Δική μας / Αντίδικη / Ουδέτερος)
 */

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  MATTER_PARTY_ROLE_LABELS,
  MATTER_PARTY_ROLE_COLORS,
  MATTER_PARTY_SIDE_LABELS,
  MATTER_PARTY_SIDE_COLORS,
  MATTER_PARTY_SIDES,
  type MatterParty,
  type MatterPartySide,
  type MatterPartiesResponse,
} from '@/types/matters';
import { clientFetch, ApiClientError } from '@/lib/api-client';
import { AddPartyToMatterDialog } from './add-party-to-matter-dialog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MatterPartiesTabProps {
  matterId: string;
  response: MatterPartiesResponse;
}

// ---------------------------------------------------------------------------
// InlineBillingEdit — inline editable billing split cell
// ---------------------------------------------------------------------------

interface InlineBillingEditProps {
  matterId: string;
  matterPartyId: string;
  currentValue: number | null;
  onSaved: () => void;
}

function InlineBillingEdit({
  matterId,
  matterPartyId,
  currentValue,
  onSaved,
}: InlineBillingEditProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(
    currentValue !== null ? String(currentValue) : ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    const parsed = value === '' ? null : parseInt(value, 10);
    if (parsed !== null && (isNaN(parsed) || parsed < 0 || parsed > 100)) {
      setError('Εισάγετε αριθμό 0-100');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await clientFetch(
        `/api/v1/matters/${matterId}/parties/${matterPartyId}`,
        {
          method: 'PATCH',
          body: { billing_split_percentage: parsed },
        }
      );
      setEditing(false);
      onSaved();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Σφάλμα αποθήκευσης');
      }
    } finally {
      setSaving(false);
    }
  }, [matterId, matterPartyId, value, onSaved]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void handleSave();
    if (e.key === 'Escape') {
      setValue(currentValue !== null ? String(currentValue) : '');
      setEditing(false);
      setError(null);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          aria-label="Ποσοστό χρέωσης (0-100)"
          className={cn(
            'w-16 rounded border px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500',
            error ? 'border-red-400' : 'border-gray-300'
          )}
        />
        <span className="text-xs text-gray-400">%</span>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          aria-label="Αποθήκευση ποσοστού"
          className="rounded px-1.5 py-0.5 text-xs font-medium text-primary-600 hover:text-primary-800 disabled:opacity-40"
        >
          {saving ? '…' : '✓'}
        </button>
        <button
          type="button"
          onClick={() => {
            setValue(currentValue !== null ? String(currentValue) : '');
            setEditing(false);
            setError(null);
          }}
          aria-label="Ακύρωση επεξεργασίας"
          className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:text-gray-800"
        >
          ✕
        </button>
        {error && (
          <span role="alert" className="text-xs text-red-600">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={`Ποσοστό χρέωσης: ${currentValue !== null ? currentValue + '%' : '—'}. Κλικ για επεξεργασία.`}
      className="group flex items-center gap-1 rounded px-1 hover:bg-gray-100"
    >
      <span className="text-sm text-gray-700">
        {currentValue !== null ? `${currentValue}%` : '—'}
      </span>
      <span
        aria-hidden="true"
        className="text-xs text-gray-300 opacity-0 transition-opacity group-hover:opacity-100"
      >
        ✏
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// MatterPartiesTab
// ---------------------------------------------------------------------------

export function MatterPartiesTab({ matterId, response }: MatterPartiesTabProps) {
  const router = useRouter();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const parties = response.data;

  // Group parties by side
  const bySide = MATTER_PARTY_SIDES.reduce<Record<MatterPartySide, MatterParty[]>>(
    (acc, side) => {
      acc[side] = parties.filter((p) => p.side === side);
      return acc;
    },
    { ours: [], opponent: [], neutral: [] }
  );

  // Derived: sides that already have is_primary_contact=true
  const existingPrimaryContactSides = parties
    .filter((p) => p.is_primary_contact)
    .map((p) => p.side);

  // Derived: total billing split for 'ours' side
  const oursSplitTotal = bySide.ours.reduce(
    (sum, p) => sum + (p.billing_split_percentage ?? 0),
    0
  );

  const handleRemove = useCallback(
    async (matterPartyId: string, partyName: string) => {
      const confirmed = window.confirm(
        `Αφαίρεση "${partyName}" από την υπόθεση;`
      );
      if (!confirmed) return;

      setRemovingId(matterPartyId);
      setRemoveError(null);
      try {
        await clientFetch(
          `/api/v1/matters/${matterId}/parties/${matterPartyId}`,
          { method: 'DELETE' }
        );
        router.refresh();
      } catch (err) {
        if (err instanceof ApiClientError) {
          setRemoveError(err.message);
        } else {
          setRemoveError('Σφάλμα διαγραφής');
        }
      } finally {
        setRemovingId(null);
      }
    },
    [matterId, router]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {parties.length === 0
            ? 'Δεν έχουν προστεθεί συμβαλλόμενοι ακόμα.'
            : `${parties.length} συμβαλλόμενοι`}
        </p>
        <button
          type="button"
          onClick={() => setAddDialogOpen(true)}
          aria-label="Προσθήκη συμβαλλομένου στην υπόθεση"
          className={cn(
            'inline-flex items-center gap-2 rounded-xl bg-primary-500 px-4 py-2',
            'text-sm font-semibold text-white shadow-sm',
            'hover:bg-primary-600 transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 focus-visible:outline-offset-2'
          )}
        >
          <span aria-hidden="true">+</span>
          Προσθήκη Συμβαλλομένου
        </button>
      </div>

      {/* Remove error */}
      {removeError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {removeError}
        </div>
      )}

      {/* 'ours' side total billing hint */}
      {bySide.ours.length > 0 && (
        <div
          className={cn(
            'rounded-lg border px-4 py-2.5 text-sm',
            oursSplitTotal === 100
              ? 'border-green-200 bg-green-50 text-green-700'
              : oursSplitTotal > 100
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
          )}
          role="status"
          aria-live="polite"
        >
          Άθροισμα ποσοστών «Δική μας»:{' '}
          <strong>{oursSplitTotal}%</strong>
          {oursSplitTotal === 100 && ' ✓'}
          {oursSplitTotal > 100 && ' — Υπέρβαση! Ο server θα απορρίψει αλλαγές.'}
          {oursSplitTotal < 100 && oursSplitTotal > 0 && ' — Ελλιπές (απαιτείται 100%)'}
        </div>
      )}

      {/* Group sections */}
      {MATTER_PARTY_SIDES.map((side) => {
        const sideParties = bySide[side];
        if (sideParties.length === 0) return null;

        return (
          <section key={side} aria-labelledby={`side-heading-${side}`}>
            <div className="mb-3 flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                  MATTER_PARTY_SIDE_COLORS[side]
                )}
              >
                {MATTER_PARTY_SIDE_LABELS[side]}
              </span>
              <h3
                id={`side-heading-${side}`}
                className="sr-only"
              >
                Πλευρά: {MATTER_PARTY_SIDE_LABELS[side]}
              </h3>
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <table
                className="min-w-full divide-y divide-gray-100"
                aria-label={`Συμβαλλόμενοι — ${MATTER_PARTY_SIDE_LABELS[side]}`}
              >
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                    >
                      Ονομασία
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                    >
                      Ρόλος
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                    >
                      Ποσοστό Χρέωσης
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                    >
                      Πρωτ. Επικοινωνός
                    </th>
                    <th scope="col" className="px-4 py-2.5">
                      <span className="sr-only">Ενέργειες</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {sideParties.map((mp: MatterParty) => (
                    <tr
                      key={mp.id}
                      className={cn(
                        'transition-colors hover:bg-gray-50',
                        removingId === mp.id && 'opacity-40'
                      )}
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900">
                          {mp.party.display_name}
                        </span>
                        {mp.party.is_attorney && (
                          <span
                            className="ml-2 rounded bg-purple-50 px-1.5 py-0.5 text-xs font-medium text-purple-700"
                            title="Δικηγόρος"
                            aria-label="Δικηγόρος"
                          >
                            ΔΙΚ
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                            MATTER_PARTY_ROLE_COLORS[mp.role]
                          )}
                        >
                          {MATTER_PARTY_ROLE_LABELS[mp.role]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <InlineBillingEdit
                          matterId={matterId}
                          matterPartyId={mp.id}
                          currentValue={mp.billing_split_percentage}
                          onSaved={() => router.refresh()}
                        />
                      </td>
                      <td className="px-4 py-3">
                        {mp.is_primary_contact ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary-700"
                            aria-label="Πρωτεύων επικοινωνός"
                          >
                            <span aria-hidden="true">★</span>
                            Ναι
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            void handleRemove(mp.id, mp.party.display_name)
                          }
                          disabled={removingId === mp.id}
                          aria-label={`Αφαίρεση "${mp.party.display_name}" από την υπόθεση`}
                          className={cn(
                            'rounded px-2 py-1 text-xs font-medium text-red-600',
                            'hover:bg-red-50 hover:text-red-800 transition-colors',
                            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500',
                            'disabled:cursor-not-allowed disabled:opacity-40'
                          )}
                        >
                          {removingId === mp.id ? '…' : 'Αφαίρεση'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {/* Empty state */}
      {parties.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
          <p className="text-gray-500">Δεν υπάρχουν συμβαλλόμενοι.</p>
          <p className="mt-1 text-sm text-gray-400">
            Πατήστε «Προσθήκη Συμβαλλομένου» για να ξεκινήσετε.
          </p>
        </div>
      )}

      {/* Add party dialog */}
      <AddPartyToMatterDialog
        matterId={matterId}
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        existingPrimaryContactSides={existingPrimaryContactSides}
        oursSplitTotal={oursSplitTotal}
      />
    </div>
  );
}
