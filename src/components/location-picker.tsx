import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';

export interface RegionInfo { code: string; city: string; country: string; continent: string; flag?: string }

/**
 * The one place a location is chosen: at workspace creation. Grouped by
 * continent, searchable by city, country or code. The caller preselects the
 * server's `suggested` code.
 */
export function LocationPicker({ regions, value, onChange }: { regions: RegionInfo[]; value: string; onChange: (code: string) => void }) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? regions.filter((r) => r.city.toLowerCase().includes(q) || r.country.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
      : regions;
    const byContinent = new Map<string, RegionInfo[]>();
    for (const r of matched) {
      const g = byContinent.get(r.continent);
      if (g) g.push(r); else byContinent.set(r.continent, [r]);
    }
    return [...byContinent.entries()];
  }, [regions, query]);
  return (
    <div>
      <Input value={query} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)} placeholder="Search a city or country" className="h-9 mb-2" aria-label="Search locations" />
      <div role="listbox" aria-label="Location" className="max-h-56 overflow-y-auto rounded-lg border">
        {/* A listbox may own only options and groups, so the per-continent
            wrapper carries the role its markup already implies; the visible
            heading is hidden from AT because the group's name already says it. */}
        {groups.map(([continent, rows]) => (
          <div key={continent} role="group" aria-label={continent}>
            <div aria-hidden="true" className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40">{continent}</div>
            {rows.map((r) => (
              <button
                key={r.code}
                type="button"
                role="option"
                aria-selected={r.code === value}
                onClick={() => onChange(r.code)}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left hover:bg-muted/50 ${r.code === value ? 'bg-primary/10 font-medium' : ''}`}
              >
                <span>{r.flag ? `${r.flag} ` : ''}{r.city}, {r.country}</span>
                <span className="text-muted-foreground">{r.code}</span>
              </button>
            ))}
          </div>
        ))}
        {/* Branch on the input, not the output: an empty list means there was
            nothing to search, which is not the same as a query that missed. */}
        {regions.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">No locations available.</div>}
        {regions.length > 0 && groups.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">No location matches.</div>}
      </div>
    </div>
  );
}
