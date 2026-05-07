'use client';

/**
 * CalendarPageClient — client shell for the calendar page.
 * Handles: view toggle (month/week), filters, new event modal, event click.
 */

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { CalendarGrid } from '@/components/calendar/calendar-grid';
import { NewEventDialog } from '@/components/calendar/new-event-dialog';
import { EVENT_TYPES, EVENT_TYPE_LABELS, EVENT_TYPE_DOT_COLORS } from '@/types/calendar';
import type { CalendarEvent, CalendarEventsResponse, EventType } from '@/types/calendar';
import STATIC_RULES_RAW from '@/lib/calendar-rules-static';
import type { CalendarRule } from '@/types/calendar';

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CalendarPageClientProps {
  eventsResponse: CalendarEventsResponse;
  initialYear: number;
  initialMonth: number;
}

// ---------------------------------------------------------------------------
// Event detail popover
// ---------------------------------------------------------------------------

interface EventDetailProps {
  event: CalendarEvent;
  onClose: () => void;
}

function EventDetail({ event, onClose }: EventDetailProps) {
  const formattedDate = new Intl.DateTimeFormat('el-GR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(!event.all_day && { hour: '2-digit', minute: '2-digit' }),
  }).format(new Date(event.occurs_at));

  return (
    <div
      role="dialog"
      aria-labelledby="event-detail-title"
      aria-modal="false"
      className="fixed inset-x-4 bottom-4 z-40 max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl sm:inset-auto sm:right-4 sm:top-20"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 id="event-detail-title" className="font-semibold text-gray-900">
          {event.title_gr}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Κλείσιμο λεπτομερειών"
          className="shrink-0 text-gray-400 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 rounded"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      <dl className="space-y-2 text-sm">
        <div>
          <dt className="font-medium text-gray-500">Ημερομηνία</dt>
          <dd className="text-gray-900">{formattedDate}</dd>
        </div>
        {event.location && (
          <div>
            <dt className="font-medium text-gray-500">Τοποθεσία</dt>
            <dd className="text-gray-900">{event.location}</dd>
          </div>
        )}
        {event.description_gr && (
          <div>
            <dt className="font-medium text-gray-500">Περιγραφή</dt>
            <dd className="text-gray-700 whitespace-pre-line">{event.description_gr}</dd>
          </div>
        )}
        {event.deadline_rule_id && (
          <div>
            <dt className="font-medium text-gray-500">Κανόνας</dt>
            <dd className="font-mono text-xs text-gray-600">{event.deadline_rule_id}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CalendarPageClient({
  eventsResponse,
  initialYear,
  initialMonth,
}: CalendarPageClientProps) {
  const [newEventOpen, setNewEventOpen] = useState(false);
  const [newEventDate, setNewEventDate] = useState<Date | undefined>(undefined);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [filterType, setFilterType] = useState<EventType | 'all'>('all');
  const [filterMatterId, setFilterMatterId] = useState<string>('');

  const rules = STATIC_RULES_RAW as CalendarRule[];

  // Filter events
  const filteredEvents = useMemo(() => {
    let evs = eventsResponse.data;
    if (filterType !== 'all') {
      evs = evs.filter((e) => e.event_type === filterType);
    }
    if (filterMatterId.trim()) {
      evs = evs.filter((e) => e.matter_id === filterMatterId.trim());
    }
    return evs;
  }, [eventsResponse.data, filterType, filterMatterId]);

  const handleNewEvent = useCallback((date: Date) => {
    setNewEventDate(date);
    setNewEventOpen(true);
  }, []);

  const handleEventClick = useCallback((event: CalendarEvent) => {
    setSelectedEvent((prev) => (prev?.id === event.id ? null : event));
  }, []);

  const initialDate = useMemo(
    () => new Date(initialYear, initialMonth, 1),
    [initialYear, initialMonth]
  );

  const upcomingEvents = useMemo(() => {
    const now = new Date();
    return filteredEvents
      .filter((e) => new Date(e.occurs_at) >= now)
      .sort((a, b) => new Date(a.occurs_at).getTime() - new Date(b.occurs_at).getTime())
      .slice(0, 5);
  }, [filteredEvents]);

  return (
    <>
      {/* Page header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ημερολόγιο</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Προθεσμίες, δικάσιμοι και συναντήσεις
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/calendar/calculator"
            className={cn(
              'rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700',
              'hover:bg-gray-50 transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
            )}
            aria-label="Υπολογιστής προθεσμιών ΚΠολΔ"
          >
            Υπολογιστής Προθεσμιών
          </Link>

          <button
            type="button"
            onClick={() => {
              setNewEventDate(undefined);
              setNewEventOpen(true);
            }}
            aria-label="Νέο γεγονός"
            className={cn(
              'rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white',
              'hover:bg-primary-600 transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
            )}
          >
            + Νέο Γεγονός
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <label htmlFor="filter-event-type" className="sr-only">
            Φίλτρο τύπου γεγονότος
          </label>
          <select
            id="filter-event-type"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as EventType | 'all')}
            aria-label="Φίλτρο τύπου γεγονότος"
            className={cn(
              'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700',
              'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-colors'
            )}
          >
            <option value="all">Όλοι οι τύποι</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        {/* Legend */}
        <div className="ml-auto flex items-center gap-4" aria-label="Υπόμνημα τύπων γεγονότων">
          {EVENT_TYPES.filter((t) => t !== 'court_holiday').map((t) => (
            <div key={t} className="flex items-center gap-1.5">
              <span
                className={cn('h-2.5 w-2.5 rounded-full', EVENT_TYPE_DOT_COLORS[t])}
                aria-hidden="true"
              />
              <span className="text-xs text-gray-500">{EVENT_TYPE_LABELS[t]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_280px]">
        {/* Calendar grid */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <CalendarGrid
            events={filteredEvents}
            onEventClick={handleEventClick}
            onNewEvent={handleNewEvent}
            initialDate={initialDate}
          />
        </div>

        {/* Upcoming sidebar */}
        <aside aria-label="Επερχόμενα γεγονότα">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">
              Επόμενα Γεγονότα
            </h2>

            {upcomingEvents.length === 0 ? (
              <p className="text-sm text-gray-400">Δεν υπάρχουν επερχόμενα γεγονότα.</p>
            ) : (
              <ul className="space-y-2">
                {upcomingEvents.map((event) => {
                  const dotColor = EVENT_TYPE_DOT_COLORS[event.event_type];
                  const formatted = new Intl.DateTimeFormat('el-GR', {
                    day: 'numeric',
                    month: 'short',
                    ...(event.all_day ? {} : { hour: '2-digit', minute: '2-digit' }),
                  }).format(new Date(event.occurs_at));

                  return (
                    <li key={event.id}>
                      <button
                        type="button"
                        onClick={() => handleEventClick(event)}
                        aria-label={`${EVENT_TYPE_LABELS[event.event_type]}: ${event.title_gr}, ${formatted}`}
                        className={cn(
                          'w-full rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 text-left transition-colors',
                          'hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', dotColor)}
                            aria-hidden="true"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-gray-900">
                              {event.title_gr}
                            </p>
                            <p className="mt-0.5 text-xs text-gray-500">{formatted}</p>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {/* Event detail popover */}
      {selectedEvent && (
        <EventDetail
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}

      {/* New event dialog */}
      <NewEventDialog
        open={newEventOpen}
        onClose={() => setNewEventOpen(false)}
        rules={rules}
        prefillDate={newEventDate}
      />
    </>
  );
}
