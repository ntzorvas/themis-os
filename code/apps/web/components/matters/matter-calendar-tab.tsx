'use client';

/**
 * MatterCalendarTab — tab Ημερολόγιο για σελίδα λεπτομερειών υπόθεσης.
 * Δείχνει upcoming events για τη συγκεκριμένη υπόθεση.
 * "Νέα προθεσμία για αυτή την υπόθεση" shortcut → NewEventDialog prefilled.
 */

import { useState, useEffect } from 'react';
import { NewEventDialog } from '@/components/calendar/new-event-dialog';
import { EventPill } from '@/components/calendar/event-pill';
import {
  EVENT_TYPE_LABELS,
  GREEK_DAYS_FULL,
  GREEK_MONTHS_GEN,
  type CalendarEvent,
  type CalendarEventsResponse,
  type CalendarRule,
} from '@/types/calendar';
import { clientFetch } from '@/lib/api-client';
import STATIC_RULES_RAW from '@/lib/calendar-rules-static';

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function formatGreekDateTime(isoString: string, allDay: boolean): string {
  const date = new Date(isoString);
  const dayName = GREEK_DAYS_FULL[date.getDay()] ?? '';
  const day = date.getDate();
  const month = GREEK_MONTHS_GEN[date.getMonth()] ?? '';
  const year = date.getFullYear();

  if (allDay) {
    return `${dayName}, ${day} ${month} ${year}`;
  }

  const time = new Intl.DateTimeFormat('el-GR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  return `${dayName}, ${day} ${month} ${year} — ${time}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MatterCalendarTabProps {
  matterId: string;
  matterTitle: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MatterCalendarTab({ matterId, matterTitle }: MatterCalendarTabProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEventOpen, setNewEventOpen] = useState(false);

  const rules = STATIC_RULES_RAW as CalendarRule[];

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const now = new Date();
        const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
          .toISOString()
          .split('T')[0]!;
        const to = new Date(now.getFullYear(), now.getMonth() + 6, 0)
          .toISOString()
          .split('T')[0]!;

        const res = await clientFetch<CalendarEventsResponse>(
          `/api/v1/calendar/events?matter_id=${encodeURIComponent(matterId)}&from=${from}&to=${to}&per_page=50`
        );
        setEvents(res.data);
      } catch {
        setEvents([]);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [matterId]);

  const now = new Date();
  const upcomingEvents = events
    .filter((e) => new Date(e.occurs_at) >= now)
    .sort((a, b) => new Date(a.occurs_at).getTime() - new Date(b.occurs_at).getTime());

  const pastEvents = events
    .filter((e) => new Date(e.occurs_at) < now)
    .sort((a, b) => new Date(b.occurs_at).getTime() - new Date(a.occurs_at).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">
          Ημερολόγιο Υπόθεσης
        </h2>
        <button
          type="button"
          onClick={() => setNewEventOpen(true)}
          aria-label={`Νέα προθεσμία για υπόθεση: ${matterTitle}`}
          className={cn(
            'rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-medium text-white',
            'hover:bg-primary-600 transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
          )}
        >
          + Νέα Προθεσμία
        </button>
      </div>

      {loading && (
        <div
          aria-label="Φόρτωση γεγονότων…"
          className="h-40 animate-pulse rounded-xl bg-gray-100"
        />
      )}

      {!loading && events.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-10 text-center">
          <p className="text-sm font-medium text-gray-500">
            Δεν υπάρχουν γεγονότα για αυτή την υπόθεση.
          </p>
          <p className="mt-1 text-sm text-gray-400">
            Προσθέστε προθεσμίες, δικάσιμους ή συναντήσεις.
          </p>
          <button
            type="button"
            onClick={() => setNewEventOpen(true)}
            aria-label="Νέο γεγονός για αυτή την υπόθεση"
            className={cn(
              'mt-4 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white',
              'hover:bg-primary-600 transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
            )}
          >
            Προσθήκη πρώτου γεγονότος
          </button>
        </div>
      )}

      {!loading && upcomingEvents.length > 0 && (
        <section aria-label="Επερχόμενα γεγονότα">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Επερχόμενα
          </h3>
          <ul className="space-y-2">
            {upcomingEvents.map((event) => (
              <li
                key={event.id}
                className="rounded-xl border border-gray-200 bg-white p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <EventPill event={event} />
                    <p className="mt-2 text-xs text-gray-500">
                      {formatGreekDateTime(event.occurs_at, event.all_day)}
                    </p>
                    {event.location && (
                      <p className="mt-0.5 text-xs text-gray-400">{event.location}</p>
                    )}
                    {event.description_gr && (
                      <p className="mt-1.5 text-sm text-gray-600 line-clamp-2">
                        {event.description_gr}
                      </p>
                    )}
                  </div>
                  <span
                    aria-label={`Τύπος: ${EVENT_TYPE_LABELS[event.event_type]}`}
                    className="shrink-0 rounded-md bg-gray-50 px-2 py-0.5 text-xs text-gray-500"
                  >
                    {EVENT_TYPE_LABELS[event.event_type]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!loading && pastEvents.length > 0 && (
        <section aria-label="Παρελθόντα γεγονότα">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Πρόσφατα (Παρελθόν)
          </h3>
          <ul className="space-y-2 opacity-60">
            {pastEvents.map((event) => (
              <li
                key={event.id}
                className="rounded-xl border border-gray-100 bg-gray-50 p-3"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-700 line-through">
                      {event.title_gr}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {formatGreekDateTime(event.occurs_at, event.all_day)}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-gray-400">
                    {EVENT_TYPE_LABELS[event.event_type]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* New event dialog — prefilled με matter_id */}
      <NewEventDialog
        open={newEventOpen}
        onClose={() => setNewEventOpen(false)}
        rules={rules}
        matterId={matterId}
      />
    </div>
  );
}
