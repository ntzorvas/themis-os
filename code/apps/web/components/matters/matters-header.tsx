'use client';

/**
 * MattersHeader — Client Component
 * Περιέχει τον τίτλο + κουμπί "Νέα Υπόθεση" + NewMatterDialog state.
 * Χωρισμός από το RSC page ώστε το dialog state να παραμένει client-only.
 */

import { useState } from 'react';
import { NewMatterDialog } from './new-matter-dialog';

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

interface MattersHeaderProps {
  totalCount: number;
}

export function MattersHeader({ totalCount }: MattersHeaderProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Υποθέσεις
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {totalCount === 0
              ? 'Δεν υπάρχουν υποθέσεις ακόμα'
              : `${totalCount} σύνολο`}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          aria-label="Δημιουργία νέας υπόθεσης"
          className={cn(
            'inline-flex items-center gap-2 rounded-xl bg-primary-500 px-5 py-2.5',
            'text-sm font-semibold text-white shadow-sm',
            'hover:bg-primary-600 transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 focus-visible:outline-offset-2'
          )}
        >
          <span aria-hidden="true">+</span>
          Νέα Υπόθεση
        </button>
      </div>

      <NewMatterDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}
