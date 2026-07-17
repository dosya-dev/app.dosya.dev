import { useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import { FolderPickerDialog } from '@/components/folder-picker-dialog';
import type { MapFilters } from '@/lib/map-pins';

const CHIP = 'rounded-full bg-background/90 backdrop-blur px-3 py-1.5 text-xs shadow flex items-center gap-1.5';

// Native date input <-> inclusive epoch-second bounds (UTC day edges, matching
// how captured_at is stored as ISO/UTC).
function toDateInput(epoch?: number | null): string {
  return epoch == null ? '' : new Date(epoch * 1000).toISOString().slice(0, 10);
}
function fromDateInput(v: string, endOfDay: boolean): number | null {
  if (!v) return null;
  const ms = Date.parse(`${v}T${endOfDay ? '23:59:59' : '00:00:00'}Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * Compact filter bar for the map: scope pins by folder (recursive) and by
 * date range. Purely controlled — owns only the folder-picker dialog's
 * open state. Selecting the root/Home in the picker clears the folder filter.
 */
export function MapFilterPanel({ value, onChange, workspaceId }: {
  value: MapFilters;
  onChange: (next: MapFilters) => void;
  workspaceId: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const active = Boolean(value.folderId) || value.from != null || value.to != null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={`${CHIP} hover:bg-muted/60`} onClick={() => setPickerOpen(true)}
        title="Filter by folder">
        <FolderOpen className="size-3.5 text-muted-foreground" />
        <span className="max-w-[9rem] truncate">{value.folderName || 'All folders'}</span>
      </button>

      <div className={CHIP}>
        <span className="text-muted-foreground">From</span>
        <input
          type="date"
          className="bg-transparent outline-none [color-scheme:light] dark:[color-scheme:dark]"
          value={toDateInput(value.from)}
          max={toDateInput(value.to) || undefined}
          onChange={(e) => onChange({ ...value, from: fromDateInput(e.target.value, false) })}
        />
        <span className="text-muted-foreground">To</span>
        <input
          type="date"
          className="bg-transparent outline-none [color-scheme:light] dark:[color-scheme:dark]"
          value={toDateInput(value.to)}
          min={toDateInput(value.from) || undefined}
          onChange={(e) => onChange({ ...value, to: fromDateInput(e.target.value, true) })}
        />
      </div>

      {active && (
        <button type="button" className={`${CHIP} hover:bg-muted/60`} onClick={() => onChange({})}
          title="Clear filters">
          <X className="size-3.5" /> Clear
        </button>
      )}

      <FolderPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        workspaceId={workspaceId}
        selectedId={value.folderId ?? null}
        selectedName={value.folderName ?? ''}
        title="Filter map by folder"
        confirmLabel="Apply folder"
        onSelect={(id, name) => {
          // Root/Home (id === null) clears the folder scope.
          onChange({ ...value, folderId: id, folderName: id ? name : null });
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
