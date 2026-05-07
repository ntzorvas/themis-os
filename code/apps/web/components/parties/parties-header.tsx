'use client';

/**
 * PartiesHeader — Client Component
 * Περιέχει τον τίτλο + κουμπί "Νέο Συμβαλλόμενο" + NewPartyDialog state.
 * Χωρισμός από το RSC page ώστε το dialog state να παραμένει client-only.
 */

import { useState } from 'react';
import { NewPartyDialog } from './new-party-dialog';

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

interface PartiesHeaderProps {
  totalCount: number;
}

export function PartiesHeader({ totalCount }: PartiesHeaderProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Συμβαλλόμενοι
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {totalCount === 0
              ? 'Δεν υπάρχουν συμβαλλόμενοι ακόμα'
              : `${totalCount} σύνολο`}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          aria-label="Δημιουργία νέου συμβαλλομένου"
          className={cn(
            'inline-flex items-center gap-2 rounded-xl bg-primary-500 px-5 py-2.5',
            'text-sm font-semibold text-white shadow-sm',
            'hover:bg-primary-600 transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 focus-visible:outline-offset-2'
          )}
        >
          <span aria-hidden="true">+</span>
          Νέο Συμβαλλόμενο
        </button>
      </div>

      <NewPartyDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}
