import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Folder, ArrowUpRight, Clock } from 'lucide-react';
import { localDigits } from '@/lib/format-locale';
import { CONTENT_DEBOUNCE_MS, searchContentWithRetry, type ContentHit } from '@/lib/ai-search';
import { personaHref, type PersonaCard } from '@/lib/personas';
import { usePersonasVisible } from '@/hooks/use-personas-access';
import { FaceAvatar } from '@/components/personas/face-avatar';
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
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';

interface FileHit { id: string; name: string; size_bytes: number; extension: string; folder_id: string | null; uploader_name: string }
interface FolderHit { id: string; name: string; file_count: number }
interface FileSearch { files: FileHit[]; folders: FolderHit[] }

type ItemRow = { key: string; group: 'top' | 'goto' | 'integration' | 'help' | 'recent'; item: SearchItem | RecentItem };
type Row = ItemRow | { key: string; group: 'files'; file: FileHit } | { key: string; group: 'folders'; folder: FolderHit }
  | { key: string; group: 'content'; hit: ContentHit } | { key: string; group: 'people'; persona: PersonaCard };


const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const inField = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
// Rich editors use Cmd+K for "insert link"; leave it to them.
const inRichText = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('textarea, [contenteditable="true"], [contenteditable=""]');

type GroupKey = 'top' | 'recent' | 'people' | 'files' | 'content' | 'goto' | 'integration' | 'help';
const groupOf = (row: Row): GroupKey => (row.group === 'folders' ? 'files' : row.group);
const GROUP_TITLE: Record<GroupKey, MessageKey | null> = {
  top: null,
  recent: 'common.label.recent',
  people: 'personas.label.people',
  files: 'common.label.filesFolders',
  content: 'search.label.inFileContents',
  goto: 'common.label.goTo',
  integration: 'common.heading.integrations',
  help: 'common.description.help',
};

export function GlobalSearch() {
  const t = useT();
  // Rebuilt when the language changes: the list holds translated titles.
  const GOTO = useMemo(() => goToItems(), [t]);
  const INTEGRATIONS_ITEMS = useMemo(() => integrationItems(), [t]);
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const userId = useSession((s) => s.user?.id);
  const { can, isResolved } = usePermissions();
  const navigate = useNavigate();
  // People and the Personas settings row only for a role that may see files.
  const mayAskPersonas = isResolved && can('access_files');

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
  // Content search (AI search) runs beside the name search, on its own
  // debounce and its own sequence: a slow, busy or refused content request
  // never delays, hides or clears the name results.
  const [contentHits, setContentHits] = useState<ContentHit[] | null>(null);
  const [contentState, setContentState] = useState<'idle' | 'loading' | 'busy'>('idle');
  const contentSeqRef = useRef(0);
  const contentCtrlRef = useRef<AbortController | null>(null);
  const contentTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // People (Personas): named people whose name starts with the typed text,
  // found by this device's engine (nothing is sent anywhere). Choosing one
  // goes to their persona page.
  const [personHits, setPersonHits] = useState<PersonaCard[] | null>(null);
  const peopleSeqRef = useRef(0);

  const help = useQuery({ queryKey: HELP_INDEX_QUERY_KEY, queryFn: fetchHelpIndex, enabled: helpWanted, staleTime: 3_600_000, retry: false });
  // The Personas settings row shows wherever Personas does.
  const personasShown = usePersonasVisible(mayAskPersonas);

  // Ranking ~80 static items is cheaper than memoising around `can`, which is
  // a new function every render. Nothing below keys effects on object identity.
  const q = query.trim();
  const ranked = rankItems(q, [
    ...visibleItems(GOTO, can).filter((i) => i.id !== 'goto:personas-settings' || personasShown),
    ...INTEGRATIONS_ITEMS, ...(help.data ?? []),
  ]);
  const recents = q ? [] : getRecents(userId, wsId);

  const rows: Row[] = [];
  const people = q ? (personHits ?? []).filter((p) => p.name).slice(0, 5) : [];
  if (!q) {
    for (const r of recents) rows.push({ key: `recent:${r.id}`, group: 'recent', item: r });
  } else {
    if (ranked.topHit) rows.push({ key: `top:${ranked.topHit.id}`, group: 'top', item: ranked.topHit });
    for (const p of people) rows.push({ key: `person:${p.id}`, group: 'people', persona: p });
    for (const f of fileResults?.files.slice(0, 5) ?? []) rows.push({ key: `file:${f.id}`, group: 'files', file: f });
    for (const f of fileResults?.folders.slice(0, 3) ?? []) rows.push({ key: `folder:${f.id}`, group: 'folders', folder: f });
    for (const h of contentHits?.slice(0, 5) ?? []) rows.push({ key: `content:${h.id}`, group: 'content', hit: h });
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
  if (prevWsId !== wsId) {
    setPrevWsId(wsId); setQuery(''); setOpen(false); setFileResults(null); setFileState('idle'); setContentHits(null); setContentState('idle');
    setPersonHits(null);
  }

  // Reads only refs and state setters, so one instance serves every render.
  const runContent = useCallback(async (ws: string, text: string) => {
    const seq = ++contentSeqRef.current;
    const ctrl = new AbortController();
    contentCtrlRef.current = ctrl;
    try {
      const r = await searchContentWithRetry(ws, text, {
        signal: ctrl.signal,
        onBusy: () => { if (seq === contentSeqRef.current) setContentState('busy'); },
      });
      if (seq !== contentSeqRef.current) return;
      // Only a successful answer fills the group; busy, unavailable and
      // errors leave it out (never an empty "no matches").
      setContentHits(r.kind === 'ok' ? r.files : null);
      setContentState('idle');
    } catch {
      if (seq !== contentSeqRef.current) return;
      setContentHits(null);
      setContentState('idle');
    }
  }, []);
  const cancelContent = useCallback(() => {
    clearTimeout(contentTimerRef.current);
    contentSeqRef.current++;
    contentCtrlRef.current?.abort();
    contentCtrlRef.current = null;
  }, []);
  // ...and a request still in flight for the old workspace must not land.
  useEffect(() => { clearTimeout(debounceRef.current); seqRef.current++; peopleSeqRef.current++; cancelContent(); }, [wsId, cancelContent]);
  useEffect(() => () => cancelContent(), [cancelContent]);

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

  const searchPeople = async (ws: string, text: string) => {
    const seq = peopleSeqRef.current;
    try {
      // Loaded on demand: the engine stays out of the main bundle.
      const engine = (await import('@/lib/personas-device/engine-host')).personasEngine(ws);
      const st = await engine.status();
      if (seq !== peopleSeqRef.current) return;
      setPersonHits(st.state === 'ready' ? engine.findByName(text, 5) : null);
    } catch {
      // Off, locked, offline: no People group, nothing said.
      if (seq === peopleSeqRef.current) setPersonHits(null);
    }
  };

  /** Restart the content search for `text`. */
  const scheduleContent = (text: string) => {
    cancelContent();
    setContentHits(null);
    if (!wsId || text.length < 2) { setContentState('idle'); return; }
    setContentState('loading');
    const ws = wsId;
    contentTimerRef.current = setTimeout(() => { void runContent(ws, text); }, CONTENT_DEBOUNCE_MS);
  };

  const onInput = (value: string) => {
    setQuery(value);
    setOpen(true);
    clearTimeout(debounceRef.current);
    const text = value.trim();
    seqRef.current++; // any in-flight response is now stale
    peopleSeqRef.current++;
    setFileResults(null);
    setPersonHits(null);
    scheduleContent(text);
    const names = text.length >= 2;
    if (!wsId || !text) { setFileState('idle'); return; }
    const ws = wsId;
    setFileState(names ? 'loading' : 'idle');
    debounceRef.current = setTimeout(() => {
      if (names) void searchFiles(text);
      if (personasShown) void searchPeople(ws, text);
    }, 250);
  };

  const onFocus = () => { setHelpWanted(true); setOpen(true); };
  const close = () => { setOpen(false); setActiveKey(null); };

  const toRecent = (row: Row): RecentItem | null => {
    if (row.group === 'files') return { id: `file:${row.file.id}`, kind: 'file', title: row.file.name, href: fileHref(row.file) };
    if (row.group === 'content') return { id: `file:${row.hit.id}`, kind: 'file', title: row.hit.name, href: fileHref(row.hit) };
    if (row.group === 'folders') return { id: `folder:${row.folder.id}`, kind: 'folder', title: row.folder.name, href: `/files?folder=${row.folder.id}` };
    if (row.group === 'recent') return row.item as RecentItem;
    if (row.group === 'people') return null;
    const it = row.item as SearchItem;
    if (it.kind === 'help') return null;
    return { id: it.id, kind: it.kind, title: it.title, href: it.href };
  };

  const openRow = (row: Row) => {
    if (row.group === 'people') {
      // Go to person: their persona page.
      close();
      setQuery('');
      inputRef.current?.blur();
      navigate(personaHref(row.persona.id));
      return;
    }
    const rec = toRecent(row);
    if (rec) recordRecent(userId, wsId, rec);
    close();
    setQuery('');
    inputRef.current?.blur();
    const href = row.group === 'files' ? fileHref(row.file) : row.group === 'content' ? fileHref(row.hit) : row.group === 'folders' ? `/files?folder=${row.folder.id}` : row.item.href;
    const external = row.group !== 'files' && row.group !== 'folders' && row.group !== 'content' && (row.item as SearchItem).external;
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

  const showEmpty = !!q && rows.length === 0 && fileState !== 'loading' && contentState === 'idle';
  const showDropdown = open && (rows.length > 0 || !!q);
  const optionId = (i: number) => `global-search-opt-${i}`;

  return (
    <div
      className="relative flex-1 min-w-0 max-w-[420px]"
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
          placeholder={t('common.placeholder.searchFilesSettingsIntegrationsHelp')}
          className="flex-1 h-auto border-0 rounded-none p-0 bg-transparent dark:bg-transparent text-sm focus-visible:ring-0 focus-visible:border-0"
        />
        {!showDropdown && (
          <kbd className="text-[10px] font-medium text-muted-foreground bg-muted border rounded px-1.5 py-0.5 leading-none">{isMac ? '⌘K' : t('common.label.ctrlK')}</kbd>
        )}
      </div>

      {showDropdown && (
        <div onMouseDown={(e) => e.preventDefault()} className="absolute top-[calc(100%+6px)] inset-s-0 inset-e-0 bg-popover text-popover-foreground border rounded-xl shadow-xl z-[600] max-h-[460px] overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-100">
          <ul id="global-search-list" role="listbox" className="py-1.5">
            {rows.map((row, i) => {
              const g = groupOf(row);
              const header = i === 0 || groupOf(rows[i - 1]) !== g;
              return (
                <li key={row.key} role="presentation">
                  {header && g === 'top' && <span data-search-group="top" hidden />}
                  {header && g !== 'top' && (
                    <p data-search-group={g} className="flex justify-between text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3.5 pt-2 pb-1">
                      <span>{GROUP_TITLE[g] ? t(GROUP_TITLE[g]) : ''}</span>
                      {g === 'files' && (
                        <Link to={`/search?q=${encodeURIComponent(q)}`} onClick={close} className="normal-case tracking-normal font-medium text-primary no-underline">{t('common.action.seeAll')}</Link>
                      )}
                      {g === 'help' && (
                        <a href={helpSearchUrl(q)} target="_blank" rel="noopener noreferrer" className="normal-case tracking-normal font-medium text-primary no-underline">{t('common.action.seeAll')}</a>
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
          {q && fileState === 'loading' && !fileResults && <p className="px-3.5 py-2 text-xs text-muted-foreground">{t('common.description.searchingFiles')}</p>}
          {q && fileState === 'error' && <p className="px-3.5 py-2 text-xs text-muted-foreground">{t('common.error.couldnTSearchFiles')}</p>}
          {q && contentState === 'busy' && <p data-content-busy className="px-3.5 py-2 text-xs text-muted-foreground">{t('search.status.contentSearchIsBusyRetrying')}</p>}
          {showEmpty && (
            <div className="py-5 text-center text-xs text-muted-foreground">
              <p>{t('common.label.noResultsForQ', { queryParam: q })}</p>
              <a href={helpSearchUrl(q)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-primary no-underline">
                {t('common.action.searchTheHelpCenterForQ', { q })} <ArrowUpRight className="size-3 rtl:-scale-x-100" />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function fileHref(f: { folder_id: string | null }) {
  return `/files${f.folder_id ? `?folder=${f.folder_id}` : ''}`;
}

function RowBody({ row }: { row: Row }) {
  const t = useT();
  if (row.group === 'people') {
    const p = row.persona;
    return (
      <>
        <FaceAvatar fileId={p.cover_file_id} box={p.cover_box} name={p.name} className="size-7" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate text-foreground" dir="auto">{p.name}</p>
          <p className="text-[10px] text-muted-foreground">{t('personas.action.goToPerson')}</p>
        </div>
      </>
    );
  }
  if (row.group === 'files') {
    const f = row.file;
    return (
      <>
        <div className="w-7 h-7 rounded-md flex items-center justify-center text-[7px] font-bold text-white shrink-0" style={{ background: colorFor(f.name) }}>{labelFor(f.name)}</div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate text-foreground" dir="auto">{f.name}</p>
          <p className="text-[10px] text-muted-foreground">{humanSize(f.size_bytes)}{f.uploader_name ? ` · ${f.uploader_name}` : ''}</p>
        </div>
      </>
    );
  }
  if (row.group === 'content') {
    const h = row.hit;
    return (
      <>
        <div className="w-7 h-7 rounded-md flex items-center justify-center text-[7px] font-bold text-white shrink-0 self-start" style={{ background: colorFor(h.name) }}>{labelFor(h.name)}</div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate text-foreground" dir="auto">{h.name}</p>
          {h.snippet && (
            <p className="text-[10px] text-muted-foreground line-clamp-2" dir="auto">
              {h.snippet}
              {h.page != null && <span className="ms-1 whitespace-nowrap">· {t('search.label.pagePage', { page: localDigits(h.page) })}</span>}
            </p>
          )}
        </div>
      </>
    );
  }
  if (row.group === 'folders') {
    return (
      <>
        <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center shrink-0"><Folder className="size-3.5 text-muted-foreground" /></div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate text-foreground" dir="auto">{row.folder.name}</p>
          <p className="text-[10px] text-muted-foreground">{t('common.label.filecountFiles', { fileCount: row.folder.file_count })}</p>
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
      {it.external && <ArrowUpRight className="size-3 text-muted-foreground shrink-0 rtl:-scale-x-100" />}
    </>
  );
}
