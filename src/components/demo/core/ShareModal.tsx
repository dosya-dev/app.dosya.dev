import { useEffect, useState } from 'react';
import { useDemo } from '../engine/demoState';
import { IconX } from './icons';

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

export function ShareModal() {
  const { state, dispatch } = useDemo();
  const [copied, setCopied] = useState(false);
  const file = state.files.find((f) => f.id === state.shareFileId);
  const open = Boolean(file);

  useEffect(() => { setCopied(false); }, [state.shareFileId, state.shareLink]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dispatch({ type: 'CLOSE_SHARE' }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dispatch]);

  if (!file) return null;

  async function copy() {
    if (!state.shareLink) return;
    await copyText(state.shareLink);
    setCopied(true);
    dispatch({ type: 'TOAST', toast: { text: 'Link copied - like it?', cta: true } });
  }

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-black/40 p-4"
      onClick={() => dispatch({ type: 'CLOSE_SHARE' })}>
      <div role="dialog" aria-modal="true" aria-label={`Share ${file.name}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-72 rounded-xl border border-(--demo-border) bg-(--demo-card) p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold">Share {file.name}</p>
          <button aria-label="Close" onClick={() => dispatch({ type: 'CLOSE_SHARE' })}
            className="rounded p-1 text-(--demo-muted-fg) hover:text-(--demo-fg)">
            <IconX className="size-4" />
          </button>
        </div>
        <label className="mb-1 block text-[11px] font-medium text-(--demo-muted-fg)">Link expires</label>
        <select className="mb-2 w-full rounded-md border border-(--demo-border) bg-(--demo-bg) px-2 py-1.5 text-xs"
          aria-label="Link expiry">
          <option>Never</option>
          <option>7 days</option>
          <option>30 days</option>
        </select>
        <label htmlFor="demo-share-pw" className="mb-1 block text-[11px] font-medium text-(--demo-muted-fg)">Password (optional)</label>
        <input id="demo-share-pw" type="password" placeholder="Min 8 characters"
          className="mb-3 w-full rounded-md border border-(--demo-border) bg-(--demo-bg) px-2 py-1.5 text-xs" />
        {state.shareLink ? (
          <div className="flex items-center gap-2 rounded-md border border-(--demo-border) bg-(--demo-muted) px-2.5 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-(--demo-muted-fg)">{state.shareLink}</span>
            <button onClick={copy} className="shrink-0 text-xs font-semibold text-(--demo-primary)">
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
        ) : (
          <button onClick={() => dispatch({ type: 'CREATE_LINK' })}
            className="w-full rounded-lg bg-(--demo-primary) py-2 text-xs font-semibold text-(--demo-primary-fg) hover:opacity-90">
            Create share link
          </button>
        )}
      </div>
    </div>
  );
}
