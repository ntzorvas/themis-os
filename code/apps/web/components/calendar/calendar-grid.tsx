'use client';

/**
 * CalendarGrid — month view calendar grid (7×5/6).
 * Δείχνει events grouped ανά day. Υποστηρίζει month navigation.
 * Greek month/day names. RSC-friendly (accepts events as props).
 */

import { useState, useMemo } from 'react';
import {
  GREEK_MONTHS_FULL,
  GREEK_DAYS_SHORT,
  type CalendarEvent,
} from '@/types/calendar';
import { EventPill } from './event-pill';

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CalendarGridProps {
  events: CalendarEvent[];
  onEventClick?: ((event: CalendarEvent) => void) | undefined;
  onNewEvent?: ((date: Date) => void) | undefined;
  initialDate?: Date | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function isoDate(date: Date): string {
  return date.toISOString().split('T')[0] ?? '';
}

function buildCalendarWeeks(year: number, month: number): (Date | null)[][] {
  const firstDay = new Date(year, month, 1);
  // Greek week starts on Monday (ISO) — convert Sunday=0 to Monday-first
  const startDow = (firstDay.getDay() + 6) % 7; // Mon=0, Sun=6
  const daysInMonth = getDaysInMonth(year, month);

  const cells: (Date | null)[] = [];

  // Leading empty cells
  for (let i = 0; i < startDow; i++) cells.push(null);

  // Month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(year, month, d));
  }

  // Trailing empty cells (fill to complete last week)
  while (cells.length % 7 !== 0) cells.push(null);

  // Split into weeks
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CalendarGrid({
  events,
  onEventClick,
  onNewEvent,
  initialDate,
}: CalendarGridProps) {
  const [currentDate, setCurrentDate] = useState(
    startOfMonth(initialDate ?? new Date())
  );

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const weeks = useMemo(() => buildCalendarWeeks(year, month), [year, month]);

  // Index events by date string for O(1) lookup
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = isoDate(new Date(event.occurs_at));
      const existing = map.get(key);
      if (existing) {
        existing.push(event);
      } else {
        map.set(key, [event]);
      }
    }
    return map;
  }, [events]);

  const todayStr = isoDate(new Date());

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(startOfMonth(new Date()));
  };

  return (
    <section aria-label={`Ημερολόγιο ${GREEK_MONTHS_FULL[month]} ${year}`}>
      {/* Month navigation header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-gray-900">
            {GREEK_MONTHS_FULL[month]} {year}
          </h2>
          <button
            type="button"
            onClick={goToToday}
            aria-label="Μετάβαση στον τρέχοντα μήνα"
            className={cn(
              'rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700',
              'hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
              'transition-colors'
            )}
          >
            Σήμερα
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prevMonth}
            aria-label="Προηγούμενος μήνας"
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white',
              'text-gray-600 hover:bg-gray-50 transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
            )}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            onClick={nextMonth}
            aria-label="Επόμενος μήνας"
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white',
              'text-gray-600 hover:bg-gray-50 transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
            )}
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>

      {/* Day-of-week headers — Mon…Sun (ISO, Greek) */}
      <div
        className="grid grid-cols-7 border-b border-gray-200"
        role="row"
        aria-label="Ημέρες εβδομάδας"
      >
        {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
          <div
            key={dow}
            role="columnheader"
            aria-label={GREEK_DAYS_SHORT[dow]}
            className={cn(
              'py-2 text-center text-xs font-semibold uppercase tracking-wide',
              dow === 0 || dow === 6 ? 'text-gray-400' : 'text-gray-500'
            )}
          >
            {GREEK_DAYS_SHORT[dow]}
          </div>
        ))}
      </div>

      {/* Calendar weeks */}
      <div role="grid" aria-label={`Μήνας ${GREEK_MONTHS_FULL[month]}`}>
        {weeks.map((week, wi) => (
          <div
            key={wi}
            role="row"
            className={cn(
              'grid grid-cols-7 border-b border-gray-100',
              wi === weeks.length - 1 && 'border-b-0'
            )}
          >
            {week.map((day, di) => {
              if (!day) {
                return (
                  <div
                    key={`empty-${wi}-${di}`}
                    role="gridcell"
                    aria-hidden="true"
                    className="min-h-[100px] border-r border-gray-100 bg-gray-50/50 p-1 last:border-r-0"
                  />
                );
              }

              const dayStr = isoDate(day);
              const dayEvents = eventsByDate.get(dayStr) ?? [];
              const isToday = dayStr === todayStr;
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;

              return (
                <div
                  key={dayStr}
                  role="gridcell"
                  aria-label={`${day.getDate()} ${GREEK_MONTHS_FULL[month]}`}
                  className={cn(
                    'min-h-[100px] border-r border-gray-100 p-1 last:border-r-0',
                    'relative group',
                    isWeekend ? 'bg-gray-50/40' : 'bg-white'
                  )}
                >
                  {/* Day number */}
                  <div className="mb-1 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => onNewEvent?.(day)}
                      aria-label={`Νέο γεγονός για ${day.getDate()} ${GREEK_MONTHS_FULL[month]}`}
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium transition-colors',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
                        isToday
                          ? 'bg-primary-600 text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                      )}
                    >
                      {day.getDate()}
                    </button>
                    {onNewEvent && (
                      <button
                        type="button"
                        onClick={() => onNewEvent(day)}
                        aria-label={`Νέο γεγονός ${day.getDate()} ${GREEK_MONTHS_FULL[month]}`}
                        className={cn(
                          'hidden group-hover:flex h-5 w-5 items-center justify-center rounded',
                          'text-gray-400 hover:text-primary-600 hover:bg-primary-50',
                          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500'
                        )}
                      >
                        <span aria-hidden="true" className="text-xs">+</span>
                      </button>
                    )}
                  </div>

                  {/* Events */}
                  <div className="flex flex-col gap-0.5">
                    {dayEvents.slice(0, 3).map((event) => (
                      <EventPill
                        key={event.id}
                        event={event}
                        onClick={onEventClick}
                        compact
                      />
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="pl-1 text-xs text-gray-400">
                        +{dayEvents.length - 3} ακόμα
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
