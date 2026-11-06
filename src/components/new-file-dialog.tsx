import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';
import { baseNameRange, normaliseNewFileName, NEW_FILE_SPECS, type NewFileKind } from '@/lib/blank-files';
import { validateFileName } from '@/lib/validation-policy.generated';
import { translateExternal } from '@/lib/external-text';

const TITLES: Record<NewFileKind, MessageKey> = {
  md: 'files.heading.newMarkdownFile',
  txt: 'files.heading.newTextFile',
  docx: 'files.heading.newWordDocument',
};

/**
 * Names a new blank file. Prefilled with "Untitled.<ext>" and only the base
 * name selected, so typing replaces "Untitled" and keeps the extension.
 *
 * `onCreate` gets the normalised name (extension forced right) and resolves to
 * an inline error to show, or null once the file exists; the dialog stays open
 * on an error so the name can be changed.
 */
export function NewFileDialog({ kind, onClose, onCreate }: {
  /** null = closed. */
  kind: NewFileKind | null;
  onClose: () => void;
  onCreate: (name: string, kind: NewFileKind) => Promise<string | null>;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The base name is selected when the input first takes focus (the
  // dialog's initial focus), or just after opening if focus came earlier.
  const selectPending = useRef(false);
  const selectBaseName = () => {
    const el = inputRef.current;
    if (!el || !kind) return;
    el.setSelectionRange(...baseNameRange(el.value, kind));
  };
  // Reset for each opening during render (not in the effect): the input
  // must already hold the default name when it first takes focus.
  const [openedFor, setOpenedFor] = useState<NewFileKind | null>(null);
  if (kind !== openedFor) {
    setOpenedFor(kind);
    if (kind) {
      setName(NEW_FILE_SPECS[kind].defaultName);
      setError(null);
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!kind) return;
    selectPending.current = true;
    const id = window.setTimeout(() => {
      if (!selectPending.current || !inputRef.current) return;
      selectPending.current = false;
      inputRef.current.focus();
      selectBaseName();
    }, 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const submit = async () => {
    if (!kind || busy) return;
    const finalName = normaliseNewFileName(name, kind);
    const invalid = validateFileName(finalName);
    if (invalid) { setError(translateExternal(invalid, 'toast')); return; }
    setBusy(true);
    setError(null);
    const failed = await onCreate(finalName, kind);
    setBusy(false);
    if (failed) setError(failed);
  };

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-sm" initialFocus={inputRef}>
        <DialogHeader><DialogTitle>{kind ? t(TITLES[kind]) : ''}</DialogTitle></DialogHeader>
        <Input
          ref={inputRef}
          aria-label={t('common.label.name')}
          aria-invalid={error ? true : undefined}
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setName(e.target.value); setError(null); }}
          onFocus={() => {
            if (!selectPending.current || inputRef.current?.value !== (kind ? NEW_FILE_SPECS[kind].defaultName : '')) return;
            selectPending.current = false;
            selectBaseName();
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
        />
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin me-1.5" /> : null} {t('common.action.create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
