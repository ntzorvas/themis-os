'use client';

/**
 * RuleSelector — grouped dropdown με search για επιλογή κανόνα ΚΠολΔ.
 * Groups: Τακτική / Ένδικα μέσα / Εκτέλεση / Ασφαλιστικά / Ειδικές / Παραγραφή / Γενικοί
 * Tooltip με description_gr on hover.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import type { CalendarRule, RuleCategory } from '@/types/calendar';

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Category assignment heuristic (mirrors backend tagging)
// ---------------------------------------------------------------------------

function categorizeRule(rule: CalendarRule): RuleCategory {
  const id = rule.rule_id;
  if (id.includes('efesi') || id.includes('anakopi-erimodikias') || id.includes('anairesi') || id.includes('anapsilafisi') || id.includes('tritanakopi')) {
    return 'Ένδικα Μέσα';
  }
  if (id.includes('ektelesis') || id.includes('pleistariasmou') || id.includes('katachesi') || id.includes('933') || id.includes('954') || id.includes('938')) {
    return 'Εκτέλεση';
  }
  if (id.includes('asfalistika') || id.includes('693')) {
    return 'Ασφαλιστικά';
  }
  if (id.includes('ergatikes') || id.includes('misthiotikes') || id.includes('oikogeniakes') || id.includes('ekousia') || id.includes('591')) {
    return 'Ειδικές Διαδικασίες';
  }
  if (id.includes('paragrafos') || id.includes('ak-')) {
    return 'Παραγραφή';
  }
  if (id.includes('144') || id.includes('epidosi-vs') || id.includes('diakopes')) {
    return 'Γενικοί Κανόνες';
  }
  return 'Τακτική Διαδικασία';
}

const CATEGORY_ORDER: RuleCategory[] = [
  'Τακτική Διαδικασία',
  'Ένδικα Μέσα',
  'Εκτέλεση',
  'Ασφαλιστικά',
  'Ειδικές Διαδικασίες',
  'Παραγραφή',
  'Γενικοί Κανόνες',
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RuleSelectorProps {
  rules: CalendarRule[];
  value: string;
  onChange: (ruleId: string) => void;
  disabled?: boolean | undefined;
  error?: string | undefined;
  id?: string | undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RuleSelector({
  rules,
  value,
  onChange,
  disabled = false,
  error,
  id = 'rule-selector',
}: RuleSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [tooltip, setTooltip] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedRule = rules.find((r) => r.rule_id === value);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [open]);

  // Focus search input when opening
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSelect = useCallback(
    (ruleId: string) => {
      onChange(ruleId);
      setOpen(false);
      setSearch('');
    },
    [onChange]
  );

  // Filter and group rules
  const filteredRules = search.trim()
    ? rules.filter(
        (r) =>
          r.title_gr.toLowerCase().includes(search.toLowerCase()) ||
          r.kpold_article.toLowerCase().includes(search.toLowerCase()) ||
          r.description_gr.toLowerCase().includes(search.toLowerCase())
      )
    : rules;

  const grouped: Partial<Record<RuleCategory, CalendarRule[]>> = {};
  for (const rule of filteredRules) {
    const cat = categorizeRule(rule);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat]!.push(rule);
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        id={id}
        type="button"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Επιλογή κανόνα ΚΠολΔ"
        aria-invalid={error ? 'true' : undefined}
        className={cn(
          'flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm text-left',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
          'transition-colors',
          disabled ? 'cursor-not-allowed opacity-50 bg-gray-50' : 'bg-white hover:border-gray-400 cursor-pointer',
          error ? 'border-red-400 bg-red-50' : 'border-gray-300'
        )}
      >
        <span className={cn('flex items-center gap-1.5', selectedRule ? 'text-gray-900' : 'text-gray-400')}>
          {selectedRule
            ? `${selectedRule.kpold_article} — ${selectedRule.title_gr}`
            : '— Επιλέξτε κανόνα —'}
          {selectedRule?.requires_legal_review && (
            <span
              title={selectedRule.legal_source ? `Απαιτεί νομικό έλεγχο — ${selectedRule.legal_source}` : 'Απαιτεί νομικό έλεγχο'}
              aria-label="Απαιτεί νομικό έλεγχο"
              className="shrink-0 text-yellow-500"
            >
              🟡
            </span>
          )}
        </span>
        <span aria-hidden="true" className="ml-2 text-gray-400">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="listbox"
          aria-label="Κανόνες ΚΠολΔ"
          className={cn(
            'absolute z-50 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-xl',
            'max-h-80 overflow-hidden flex flex-col'
          )}
        >
          {/* Search */}
          <div className="border-b border-gray-100 p-2">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Αναζήτηση άρθρου ή τίτλου…"
              aria-label="Αναζήτηση κανόνα"
              className={cn(
                'w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400',
                'focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400'
              )}
            />
          </div>

          {/* Groups */}
          <div className="overflow-y-auto">
            {CATEGORY_ORDER.map((cat) => {
              const catRules = grouped[cat];
              if (!catRules || catRules.length === 0) return null;

              return (
                <div key={cat}>
                  <div className="sticky top-0 bg-gray-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {cat}
                  </div>
                  {catRules.map((rule) => (
                    <button
                      key={rule.rule_id}
                      role="option"
                      type="button"
                      aria-selected={rule.rule_id === value}
                      onClick={() => handleSelect(rule.rule_id)}
                      onMouseEnter={() => setTooltip(rule.rule_id)}
                      onMouseLeave={() => setTooltip(null)}
                      className={cn(
                        'flex w-full items-start gap-3 px-3 py-2 text-left text-sm transition-colors',
                        'hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-primary-500',
                        rule.rule_id === value
                          ? 'bg-primary-50 text-primary-700'
                          : 'text-gray-700'
                      )}
                    >
                      <span className="mt-0.5 shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600">
                        {rule.kpold_article}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 font-medium leading-tight">
                          <span>{rule.title_gr}</span>
                          {rule.requires_legal_review && (
                            <span
                              title={rule.legal_source ? `Απαιτεί νομικό έλεγχο — ${rule.legal_source}` : 'Απαιτεί νομικό έλεγχο'}
                              aria-label="Απαιτεί νομικό έλεγχο"
                              className="shrink-0 text-yellow-500"
                            >
                              🟡
                            </span>
                          )}
                        </div>
                        {tooltip === rule.rule_id && (
                          <div className="mt-1 text-xs text-gray-500 leading-relaxed line-clamp-3">
                            {rule.description_gr}
                            {rule.legal_source && (
                              <span className="ml-1 text-gray-400">({rule.legal_source})</span>
                            )}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}

            {filteredRules.length === 0 && (
              <div className="py-6 text-center text-sm text-gray-400">
                Δεν βρέθηκαν κανόνες για &ldquo;{search}&rdquo;
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
