import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Folder, ArrowUpRight, Clock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { api } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { useSession } from '@/stores/session';
import { usePermissions } from '@/hooks/use-permissions';
import { humanSize, colorFor, labelFor } from '@/lib/helpers';
import { rankItems } from '@/lib/search/match';
import { goToItems, integrationItems, visibleItems } from '@/lib/search/sources';
import { fetchHelpIndex, helpSearchUrl, HELP_INDEX_QUERY_KEY } from '@/lib/search/help-index';
import { getRecents, recordRecent, type RecentItem } from '@/lib/search/recent';
import type { SearchItem } from '@/lib/search/types';

interface FileHit { id: string; name: string; size_bytes: number; extension: string; folder_id: string | null; uploader_name: string }
interface FolderHit { id: string; name: string; file_count: number }
interface FileSearch { files: FileHit[]; folders: FolderHit[] }

type ItemRow = { key: string; group: 'top' | 'goto' | 'integration' | 'help' | 'recent'; item: SearchItem | RecentItem };
type Row = ItemRow | { key: string; group: 'files'; file: FileHit } | { key: string; group: 'folders'; folder: FolderHit };

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const inField = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
// Rich editors use Cmd+K for "insert link"; leave it to them.
const inRichText = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('textarea, [contenteditable="true"], [contenteditable=""]');
// Built once: the registry and integration list are static.
const GOTO = goToItems();
const INTEGRATIONS_ITEMS = integrationItems();

type GroupKey = 'top' | 'recent' | 'files' | 'goto' | 'integration' | 'help';
const groupOf = (row: Row): GroupKey => (row.group === 'folders' ? 'files' : row.group);
const GROUP_TITLE: Record<GroupKey, string> = {
  top: '', recent: 'Recent', files: 'Files & folders', goto: 'Go to', integration: 'Integrations', help: 'Help',
};

export function GlobalSearch() {
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const userId = useSession((s) => s.user?.id);
  const { can } = usePermissions();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [helpWanted, setHelpWanted] = useState(false);
  const [fileResults, setFileResults] = useState<FileSearch | null>(null);
  const [fileState, setFileState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seqRef = useRef(0);

  const help = useQuery({ queryKey: HELP_INDEX_QUERY_KEY, queryFn: fetchHelpIndex, enabled: helpWanted, staleTime: 3_600_000, retry: false });

  // Ranking ~80 static items is cheaper than memoising around `can`, which is
  // a new function every render. Nothing below keys effects on object identity.
  const q = query.trim();
  const ranked = rankItems(q, [...visibleItems(GOTO, can), ...INTEGRATIONS_ITEMS, ...(help.data ?? [])]);
  const recents = q ? [] : getRecents(userId, wsId);

  const rows: Row[] = [];
  if (!q) {
    for (const r of recents) rows.push({ key: `recent:${r.id}`, group: 'recent', item: r });
  } else {
    if (ranked.topHit) rows.push({ key: `top:${ranked.topHit.id}`, group: 'top', item: ranked.topHit });
    for (const f of fileResults?.files.slice(0, 5) ?? []) rows.push({ key: `file:${f.id}`, group: 'files', file: f });
    for (const f of fileResults?.folders.slice(0, 3) ?? []) rows.push({ key: `folder:${f.id}`, group: 'folders', folder: f });
    for (const g of ['goto', 'integration', 'help'] as const) for (const i of ranked[g]) rows.push({ key: `${g}:${i.id}`, group: g, item: i });
  }

  // The highlight is tracked by row key: file rows land later and shift indexes.
  const active = activeKey ? rows.findIndex((r) => r.key === activeKey) : -1;

  // A strong page/integration match is pre-selected so Enter opens it; otherwise
  // nothing is. Keyed on the id, not the object, so arrow-key moves survive re-renders.
  const topHitId = ranked.topHit?.id ?? null;
  const selKey = `${q}|${topHitId ?? ''}`;
  const [prevSelKey, setPrevSelKey] = useState(selKey);
  if (prevSelKey !== selKey) { setPrevSelKey(selKey); setActiveKey(q && topHitId ? `top:${topHitId}` : null); }

  // Workspace switch: results and recents belong to the old workspace.
  const [prevWsId, setPrevWsId] = useState(wsId);
  if (prevWsId !== wsId) { setPrevWsId(wsId); setQuery(''); setOpen(false); setFileResults(null); setFileState('idle'); }
  // ...and a request still in flight for the old workspace must not land.
  useEffect(() => { clearTimeout(debounceRef.current); seqRef.current++; }, [wsId]);

  const searchFiles = async (text: string) => {
    const seq = ++seqRef.current;
    setFileState('loading');
    try {
      const data = await api<{ ok: boolean } & FileSearch>(`/api/search?workspace_id=${wsId}&q=${encodeURIComponent(text)}`);
      if (seq !== seqRef.current) return;
      setFileResults(data.ok ? { files: data.files ?? [], folders: data.folders ?? [] } : null);
      setFileState(data.ok ? 'idle' : 'error');
    } catch {
      if (seq !== seqRef.current) return;
      setFileResults(null);
      setFileState('error');
    }
  };

  const onInput = (value: string) => {
    setQuery(value);
    setOpen(true);
    clearTimeout(debounceRef.current);
    const text = value.trim();
    seqRef.current++; // any in-flight response is now stale
    setFileResults(null);
    if (!wsId || text.length < 2) { setFileState('idle'); return; }
    setFileState('loading');
    debounceRef.current = setTimeout(() => { void searchFiles(text); }, 250);
  };

  const onFocus = () => { setHelpWanted(true); setOpen(true); };
  const close = () => { setOpen(false); setActiveKey(null); };

  const toRecent = (row: Row): RecentItem | null => {
    if (row.group === 'files') return { id: `file:${row.file.id}`, kind: 'file', title: row.file.name, href: fileHref(row.file) };
    if (row.group === 'folders') return { id: `folder:${row.folder.id}`, kind: 'folder', title: row.folder.name, href: `/files?folder=${row.folder.id}` };
    if (row.group === 'recent') return row.item as RecentItem;
    const it = row.item as SearchItem;
    if (it.kind === 'help') return null;
    return { id: it.id, kind: it.kind, title: it.title, href: it.href };
  };

  const openRow = (row: Row) => {
    const rec = toRecent(row);
    if (rec) recordRecent(userId, wsId, rec);
    close();
    setQuery('');
    inputRef.current?.blur();
    const href = row.group === 'files' ? fileHref(row.file) : row.group === 'folders' ? `/files?folder=${row.folder.id}` : row.item.href;
    const external = row.group !== 'files' && row.group !== 'folders' && (row.item as SearchItem).external;
    if (external) window.open(href, '_blank', 'noopener,noreferrer');
    else navigate(href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Keep Cmd/Ctrl+K from reaching the browser's own search shortcut.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!rows.length) return;
      e.preventDefault();
      setOpen(true);
      const d = e.key === 'ArrowDown' ? 1 : -1;
      const next = active < 0 ? (d === 1 ? 0 : rows.length - 1) : (active + d + rows.length) % rows.length;
      setActiveKey(rows[next].key);
    } else if (e.key === 'Enter') {
      if (active >= 0 && rows[active]) { e.preventDefault(); openRow(rows[active]); }
      else if (q) { close(); navigate(`/search?q=${encodeURIComponent(q)}`); }
    } else if (e.key === 'Escape') {
      if (showDropdown) close(); else inputRef.current?.blur();
    }
  };

  // Global shortcuts: "/" (outside other fields) and Cmd/Ctrl+K.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target === inputRef.current) return;
      const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      const slash = e.key === '/' && !e.metaKey && !e.ctrlKey;
      if (cmdK ? !inRichText(e.target) : slash && !inField(e.target)) {
        e.preventDefault();
        inputRef.current?.focus();
        onFocus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close(); };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const showEmpty = !!q && rows.length === 0 && fileState !== 'loading';
  const showDropdown = open && (rows.length > 0 || !!q);
  const optionId = (i: number) => `global-search-opt-${i}`;

  return (
    <div
      className="relative flex-1 max-w-[420px]"
      ref={wrapRef}
      onBlur={(e) => { if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) close(); }}
    >
      <div className="flex items-center gap-2 border rounded-lg px-3 h-8 bg-card">
        <Search className="size-3.5 text-muted-foreground shrink-0" />
        <Input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="global-search-list"
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          aria-autocomplete="list"
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onInput(e.target.value)}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          placeholder="Search files, settings, integrations, help"
          className="flex-1 h-auto border-0 rounded-none p-0 bg-transparent dark:bg-transparent text-sm focus-visible:ring-0 focus-visible:border-0"
        />
        {!showDropdown && (
          <kbd className="text-[10px] font-medium text-muted-foreground bg-muted border rounded px-1.5 py-0.5 leading-none">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
        )}
      </div>

      {showDropdown && (
        <div onMouseDown={(e) => e.preventDefault()} className="absolute top-[calc(100%+6px)] left-0 right-0 bg-popover text-popover-foreground border rounded-xl shadow-xl z-[600] max-h-[460px] overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-100">
          <ul id="global-search-list" role="listbox" className="py-1.5">
            {rows.map((row, i) => {
              const g = groupOf(row);
              const header = i === 0 || groupOf(rows[i - 1]) !== g;
              return (
                <li key={row.key} role="presentation">
                  {header && g === 'top' && <span data-search-group="top" hidden />}
                  {header && g !== 'top' && (
                    <p data-search-group={g} className="flex justify-between text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3.5 pt-2 pb-1">
                      <span>{GROUP_TITLE[g]}</span>
                      {g === 'files' && (
                        <Link to={`/search?q=${encodeURIComponent(q)}`} onClick={close} className="normal-case tracking-normal font-medium text-primary no-underline">See all</Link>
                      )}
                      {g === 'help' && (
                        <a href={helpSearchUrl(q)} target="_blank" rel="noopener noreferrer" className="normal-case tracking-normal font-medium text-primary no-underline">See all</a>
                      )}
                    </p>
                  )}
                  <div
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActiveKey(row.key)}
                    onClick={() => openRow(row)}
                    className={`flex items-center gap-2.5 px-3.5 py-2 cursor-pointer ${i === active ? 'bg-muted' : 'hover:bg-muted/50'}`}
                  >
                    <RowBody row={row} />
                  </div>
                </li>
              );
            })}
          </ul>
          {q && fileState === 'loading' && !fileResults && <p className="px-3.5 py-2 text-xs text-muted-foreground">Searching files...</p>}
          {q && fileState === 'error' && <p className="px-3.5 py-2 text-xs text-muted-foreground">Couldn't search files</p>}
          {showEmpty && (
            <div className="py-5 text-center text-xs text-muted-foreground">
              <p>No results for '{q}'</p>
              <a href={helpSearchUrl(q)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-primary no-underline">
                Search the help center for '{q}' <ArrowUpRight className="size-3" />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function fileHref(f: FileHit) {
  return `/files${f.folder_id ? `?folder=${f.folder_id}` : ''}`;
}

function RowBody({ row }: { row: Row }) {
  if (row.group === 'files') {
    const f = row.file;
    return (
      <>
        <div className="w-7 h-7 rounded-md flex items-center justify-center text-[7px] font-bold text-white shrink-0" style={{ background: colorFor(f.name) }}>{labelFor(f.name)}</div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate text-foreground">{f.name}</p>
          <p className="text-[10px] text-muted-foreground">{humanSize(f.size_bytes)}{f.uploader_name ? ` · ${f.uploader_name}` : ''}</p>
        </div>
      </>
    );
  }
  if (row.group === 'folders') {
    return (
      <>
        <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center shrink-0"><Folder className="size-3.5 text-muted-foreground" /></div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate text-foreground">{row.folder.name}</p>
          <p className="text-[10px] text-muted-foreground">{row.folder.file_count} files</p>
        </div>
      </>
    );
  }
  const it = row.item as SearchItem;
  const Icon = row.group === 'recent' ? ((row.item as RecentItem).kind === 'folder' ? Folder : Clock) : it.icon;
  return (
    <>
      <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center shrink-0">
        {row.group !== 'recent' && it.iconSrc ? <img src={it.iconSrc} alt="" className="size-4" /> : Icon ? <Icon className="size-3.5 text-muted-foreground" /> : <Search className="size-3.5 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate text-foreground">{it.title}</p>
        {it.context && <p className="text-[10px] text-muted-foreground truncate">{it.context}</p>}
      </div>
      {it.external && <ArrowUpRight className="size-3 text-muted-foreground shrink-0" />}
    </>
  );
}
