'use client';

/**
 * EventPill — color-coded event badge για calendar grid cells.
 * deadline=red, hearing=blue, meeting=green, court_holiday=gray, custom=purple
 */

import { EVENT_TYPE_COLORS, EVENT_TYPE_LABELS } from '@/types/calendar';
import type { CalendarEvent, EventType } from '@/types/calendar';

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

interface EventPillProps {
  event: CalendarEvent;
  onClick?: ((event: CalendarEvent) => void) | undefined;
  compact?: boolean | undefined;
}

const EVENT_TYPE_BG: Record<EventType, string> = {
  hearing: 'bg-blue-500',
  deadline: 'bg-red-500',
  meeting: 'bg-green-500',
  court_holiday: 'bg-gray-400',
  custom: 'bg-purple-500',
};

export function EventPill({ event, onClick, compact = false }: EventPillProps) {
  const colorClass = EVENT_TYPE_COLORS[event.event_type];
  const dotColor = EVENT_TYPE_BG[event.event_type];

  const timeLabel = event.all_day
    ? null
    : new Intl.DateTimeFormat('el-GR', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(event.occurs_at));

  return (
    <button
      type="button"
      onClick={() => onClick?.(event)}
      aria-label={`${EVENT_TYPE_LABELS[event.event_type]}: ${event.title_gr}`}
      className={cn(
        'group flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition-opacity',
        'hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
        colorClass,
        'border text-xs font-medium',
        compact ? 'truncate' : ''
      )}
    >
      <span
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotColor)}
        aria-hidden="true"
      />
      <span className="truncate">
        {!compact && timeLabel && (
          <span className="mr-1 opacity-70">{timeLabel}</span>
        )}
        {event.title_gr}
      </span>
    </button>
  );
}
