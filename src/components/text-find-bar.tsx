import { useEffect, useRef } from 'react';
import { localDigits } from '@/lib/format-locale';
import { X, ChevronUp, ChevronDown } from 'lucide-react';
import type { useInFileFind } from '@/lib/use-in-file-find';
import { useT } from '@/lib/i18n';

export function TextFindBar({ find, onClose }: { find: ReturnType<typeof useInFileFind>; onClose: () => void }) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) find.prev(); else find.next(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div
      role="search"
      className="absolute top-3 inset-e-3 z-20 flex items-center gap-1 rounded-md border bg-background/95 shadow-md px-2 py-1"
      onKeyDown={onKeyDown}
    >
      <input
        ref={inputRef}
        value={find.query}
        onChange={(e) => find.setQuery(e.target.value)}
        placeholder={t('common.placeholder.find')}
        className="w-40 bg-transparent text-sm outline-none px-1"
        aria-label={t('common.accessibility.findInFile')}
      />
      <span className="text-[11px] text-muted-foreground tabular-nums min-w-12 text-center">
        {find.count ? `${localDigits(find.current)}/${localDigits(find.count)}` : (find.query ? t('common.label.noResults') : '')}
      </span>
      <button className="size-6 rounded flex items-center justify-center hover:bg-muted disabled:opacity-40"
        onClick={find.prev} disabled={!find.count} title={t('common.tooltip.previousShiftEnter')}>
        <ChevronUp className="size-3.5" />
      </button>
      <button className="size-6 rounded flex items-center justify-center hover:bg-muted disabled:opacity-40"
        onClick={find.next} disabled={!find.count} title={t('common.tooltip.nextEnter')}>
        <ChevronDown className="size-3.5" />
      </button>
      <button className="size-6 rounded flex items-center justify-center hover:bg-muted"
        onClick={onClose} title={t('common.tooltip.closeEsc')}>
        <X className="size-3.5" />
      </button>
    </div>
  );
}
