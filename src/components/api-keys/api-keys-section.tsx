import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChartColumn, ChevronDown, Copy, Loader2, Plus, Search, X } from 'lucide-react';
import { req } from '@/api/req';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { CopyCheck } from '@/components/ui/copy-check';
import { toast } from '@/lib/toast';
import { API_HOST, s3Endpoint, S3_REGION } from '@/lib/integrations';
import {
  type ApiKey, type KeyDraft, type WorkspaceRef,
  SCOPE_LABELS,
  describeDraft, draftFromKey, filterKeys, formatActiveHours, formatAnchor, formatLastUsed,
  formatSurfaces, isStale, keyAllowsS3, keyExpired, summarizeKeys,
} from '@/lib/api-keys';
import { CreateKeyDialog } from './create-key-dialog';

export type { ApiKey } from '@/lib/api-keys';

interface S3Creds { access_key_id: string; secret_access_key: string; endpoint: string; region: string }

const SCOPE_FILTER_ITEMS = [
  { value: 'all', label: 'Any permission' },
  { value: 'full', label: 'Full access' },
  { value: 'read', label: 'Read only' },
  { value: 'upload', label: 'Upload only' },
];

function shortDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Profile → API keys. A console, not a card list: a summary strip that says
// what needs attention, a toolbar to find a key, and rows that expand into
// the key's full configuration instead of truncating it into eight columns.
// Keys can't be edited (the API is create + delete only), so every action
// is revoke, duplicate, or look.
export function ApiKeysSection({ keys, workspaces, onChanged }: { keys: ApiKey[]; workspaces: WorkspaceRef[]; onChanged: () => void }) {
  const [q, setQ] = useState('');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [unrestrictedOnly, setUnrestrictedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createInitial, setCreateInitial] = useState<KeyDraft | undefined>(undefined);
  // Bumped on every open so the dialog remounts with a fresh draft (its
  // state is initialised once, from initialDraft) instead of resetting itself
  // in an effect.
  const [createSession, setCreateSession] = useState(0);
  const [created, setCreated] = useState<{ plainKey: string; draft: KeyDraft } | null>(null);
  const [copied, setCopied] = useState(false);

  const [pendingRevoke, setPendingRevoke] = useState<ApiKey[] | null>(null);
  const [revoking, setRevoking] = useState(false);

  const [s3Open, setS3Open] = useState(false);
  const [s3Loading, setS3Loading] = useState(false);
  const [s3Creds, setS3Creds] = useState<S3Creds | null>(null);

  // Folder anchors on existing keys arrive as bare IDs (GET /api/me/api-keys
  // deliberately doesn't join folder names in). Resolve any unseen ones
  // through the same GET /api/folders/:id every other folder-detail lookup
  // in this app uses. Membership is guaranteed: a key's root_folder_id can
  // only be set to a folder in a workspace the creating user belonged to.
  const [folderNames, setFolderNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const ids = [...new Set(keys.map((k) => k.root_folder_id).filter((id): id is string => !!id))];
    const missing = ids.filter((id) => !(id in folderNames));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(missing.map(async (id) => {
        const res = await req<{ ok: boolean; folder?: { name: string } }>(`/api/folders/${id}`);
        return [id, res.ok && res.folder ? res.folder.name : 'Unknown folder'] as const;
      }));
      if (!cancelled) setFolderNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    })();
    return () => { cancelled = true; };
  }, [keys, folderNames]);

  // A clock the relative "last used" column and the stale rule read from.
  // Ticking once a minute keeps "4m ago" honest on a page left open, without
  // calling Date.now() during render.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(t);
  }, []);
  const summary = useMemo(() => summarizeKeys(keys, now), [keys, now]);
  const visible = useMemo(() => filterKeys(keys, { q, scope: scopeFilter, unrestrictedOnly }), [keys, q, scopeFilter, unrestrictedOnly]);
  const filtered = visible.length !== keys.length;

  const toggleSelected = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const revoke = async () => {
    if (!pendingRevoke) return;
    setRevoking(true);
    const results = await Promise.all(pendingRevoke.map((k) => req(`/api/me/api-keys/${k.id}`, { method: 'DELETE' })));
    setRevoking(false);
    const failed = results.filter((r) => !r.ok).length;
    if (failed === 0) {
      toast.success(pendingRevoke.length === 1 ? 'Key revoked' : `${pendingRevoke.length} keys revoked`, 'Anything still using them will be refused from now on.');
    } else {
      toast.error('Revoke failed', results.find((r) => !r.ok)?.error ?? `${failed} of ${pendingRevoke.length} keys could not be revoked.`);
    }
    setPendingRevoke(null);
    setSelected(new Set());
    setExpandedId(null);
    onChanged();
  };

  const enableS3 = async (id: string) => {
    setS3Open(true); setS3Loading(true); setS3Creds(null);
    const res = await req<{ ok: boolean; s3_credentials?: S3Creds; error?: string }>('/api/me/api-keys/s3-credentials', {
      method: 'POST', body: JSON.stringify({ api_key_id: id }),
    });
    if (res.ok && res.s3_credentials) { setS3Creds(res.s3_credentials); onChanged(); }
    else { toast.error('Could not enable S3', res.error ?? 'S3 access could not be enabled.'); setS3Open(false); }
    setS3Loading(false);
  };

  const viewS3 = (k: ApiKey) => {
    if (!k.s3_access_key_id) return;
    setS3Creds({
      access_key_id: k.s3_access_key_id,
      secret_access_key: '(secret key is not retrievable - revoke and recreate the key to rotate)',
      endpoint: s3Endpoint(),
      region: S3_REGION,
    });
    setS3Loading(false); setS3Open(true);
  };

  const duplicate = (k: ApiKey) => {
    setCreateInitial(draftFromKey(k, k.root_folder_id ? folderNames[k.root_folder_id] ?? '' : ''));
    setCreateSession((n) => n + 1);
    setCreateOpen(true);
  };
  const openNew = () => { setCreateInitial(undefined); setCreateSession((n) => n + 1); setCreateOpen(true); };

  const copyKey = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(created.plainKey);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const selectedKeys = keys.filter((k) => selected.has(k.id));

  return (
    <section id="section-api">
      <h2 className="text-base font-semibold mb-3">API keys</h2>
      <Card className="py-0 gap-0 overflow-hidden">
        {/* Summary strip */}
        <div className="flex items-center gap-x-5 gap-y-2 flex-wrap px-4 py-3 border-b" data-testid="summary-strip">
          <Stat n={summary.total} label={summary.total === 1 ? 'key' : 'keys'} />
          {summary.unrestricted > 0 && <Stat n={summary.unrestricted} label="unrestricted" tone="warn" title="Full access to the whole account, from anywhere, never expires" />}
          {summary.stale > 0 && <Stat n={summary.stale} label="unused for 90+ days" tone="warn" />}
          {summary.expiringSoon > 0 && <Stat n={summary.expiringSoon} label="expiring within 30 days" />}
          <span className="flex-1" />
          <Button size="sm" data-testid="new-key" onClick={openNew}><Plus className="size-3.5" /> New API key</Button>
        </div>

        {keys.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm font-medium">No API keys yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[40ch] mx-auto">A key lets an app or a script reach your files without your password. Make one for each tool you connect.</p>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b">
              <label className="flex items-center gap-2 flex-1 min-w-40 h-8 px-2.5 rounded-lg border text-muted-foreground focus-within:border-ring">
                <Search className="size-3.5 shrink-0" />
                <input
                  data-testid="key-search" aria-label="Search keys" placeholder="Search name or prefix"
                  value={q} onChange={(e) => setQ(e.target.value)}
                  className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
                />
              </label>
              <Select value={scopeFilter} onValueChange={(v) => setScopeFilter((v as string) ?? 'all')} items={SCOPE_FILTER_ITEMS}>
                <SelectTrigger className="h-8 text-xs w-auto min-w-36" aria-label="Filter by permission"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCOPE_FILTER_ITEMS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                variant="outline" size="sm" data-testid="filter-unrestricted" aria-pressed={unrestrictedOnly}
                onClick={() => setUnrestrictedOnly((v) => !v)}
                className={unrestrictedOnly ? 'border-amber-600/60 text-amber-700 dark:text-amber-400' : ''}
              >
                Unrestricted only
              </Button>
              {selected.size > 0 && (
                <>
                  <span className="flex-1" />
                  <Button
                    variant="outline" size="sm" data-testid="bulk-revoke"
                    className="text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => setPendingRevoke(selectedKeys)}
                  >
                    <X className="size-3.5" /> Revoke {selected.size}
                  </Button>
                </>
              )}
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-[28px_1.5fr_0.8fr_1fr_1.1fr_0.9fr_32px] gap-3 items-center px-4 pb-2 pt-2.5 border-b">
                  <span><span className="sr-only">Select</span></span>
                  {['Name', 'Permission', 'Protocols', 'Reach', 'Last used'].map((h) => (
                    <span key={h} className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{h}</span>
                  ))}
                  <span />
                </div>

                {visible.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">No keys match.</p>
                ) : visible.map((k) => {
                  const open = expandedId === k.id;
                  const stale = isStale(k, now);
                  const expired = keyExpired(k, now);
                  const ipCount = k.allowed_ips ? k.allowed_ips.split(',').filter((s) => s.trim()).length : 0;
                  return (
                    <div key={k.id} className="border-b last:border-b-0">
                      <div
                        data-testid="key-row" data-key-id={k.id}
                        className={`grid grid-cols-[28px_1.5fr_0.8fr_1fr_1.1fr_0.9fr_32px] gap-3 items-center px-4 py-2.5 ${open ? 'bg-muted/40' : 'hover:bg-muted/30'}`}
                      >
                        <Checkbox
                          data-testid="key-select" aria-label={`Select ${k.name}`} className="size-4"
                          checked={selected.has(k.id)} onCheckedChange={() => toggleSelected(k.id)}
                        />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[13px] font-medium truncate">{k.name}</span>
                            {expired ? <Badge variant="secondary" className="text-[10px] font-medium text-destructive shrink-0">Expired</Badge>
                              : k.expires_at !== null ? <Badge variant="secondary" className="text-[10px] font-medium shrink-0">Expires {shortDate(k.expires_at)}</Badge> : null}
                          </span>
                          <span className="block text-[11px] text-muted-foreground font-mono">dos_····{k.key_prefix.slice(0, 4)}</span>
                        </span>
                        <span><Badge variant={k.scope === 'full' ? 'default' : 'secondary'} className="text-[10px]">{SCOPE_LABELS[k.scope] ?? k.scope}</Badge></span>
                        <span className="text-[11.5px] text-muted-foreground truncate" title={formatSurfaces(k.surfaces)}>{formatSurfaces(k.surfaces)}</span>
                        <span className="min-w-0">
                          <span className="block text-[11.5px] text-muted-foreground truncate" title={formatAnchor(k, workspaces, folderNames)}>{formatAnchor(k, workspaces, folderNames)}</span>
                          {(ipCount > 0 || k.active_hours) && (
                            <span className="flex gap-1 mt-0.5">
                              {ipCount > 0 && <Badge variant="secondary" className="text-[9.5px] font-medium">{ipCount} IP range{ipCount === 1 ? '' : 's'}</Badge>}
                              {k.active_hours && <Badge variant="secondary" className="text-[9.5px] font-medium">Set hours</Badge>}
                            </span>
                          )}
                        </span>
                        <span
                          data-testid="last-used" data-stale={stale ? 'true' : undefined}
                          title={stale ? 'Not used in 90 days. If nothing needs it, revoke it.' : undefined}
                          className={stale
                            ? 'inline-flex w-fit items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'text-[11.5px] text-muted-foreground'}
                        >
                          {formatLastUsed(k, now)}
                        </span>
                        <button
                          type="button" data-testid="key-expand" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${k.name}`}
                          onClick={() => setExpandedId(open ? null : k.id)}
                          className="size-7 grid place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <ChevronDown className={`size-3.5 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
                        </button>
                      </div>

                      {open && (
                        <div data-testid="key-details" data-key-id={k.id} className="px-4 pb-4 pt-1 bg-muted/40">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-3 border-t border-border/60">
                            <dl className="space-y-1.5">
                              <Heading>Configuration</Heading>
                              <Row k="Permission" v={SCOPE_LABELS[k.scope] ?? k.scope} />
                              <Row k="Protocols" v={formatSurfaces(k.surfaces)} />
                              <Row k="Reach" v={formatAnchor(k, workspaces, folderNames)} />
                              <Row k="Created" v={shortDate(k.created_at)} />
                              <Row k="Expires" v={k.expires_at === null ? 'Never' : expired ? `Expired ${shortDate(k.expires_at)}` : shortDate(k.expires_at)} />
                            </dl>
                            <dl className="space-y-1.5">
                              <Heading>Guards</Heading>
                              <Row k="IP allowlist" v={ipCount === 0 ? 'Any address' : `${ipCount} range${ipCount === 1 ? '' : 's'}`} title={k.allowed_ips ?? undefined} />
                              <Row k="Active hours" v={k.active_hours ? formatActiveHours(k.active_hours) : 'Any time'} />
                              <Row k="Last used" v={formatLastUsed(k, now)} />
                              <div className="flex justify-between gap-3 text-[11.5px]">
                                <dt className="text-muted-foreground">S3 credentials</dt>
                                <dd className="font-medium text-right" data-testid="s3-status">
                                  {k.s3_access_key_id ? (
                                    <button type="button" data-testid="s3-show" onClick={() => viewS3(k)} className="text-green-700 dark:text-green-400 hover:underline underline-offset-2">Active · show</button>
                                  ) : expired ? (
                                    <span title="This key has expired. Create a new key to use S3." className="text-muted-foreground">Expired</span>
                                  ) : keyAllowsS3(k.surfaces) ? (
                                    <button type="button" data-testid="s3-enable" onClick={() => enableS3(k.id)} className="hover:underline underline-offset-2">Enable</button>
                                  ) : (
                                    <span title="This key's protocols don't include the S3 gateway. Create a key that allows S3 to use it." className="text-muted-foreground">Not allowed</span>
                                  )}
                                </dd>
                              </div>
                            </dl>
                            <div className="space-y-2">
                              <Heading>Actions</Heading>
                              <div className="flex flex-wrap gap-1.5">
                                <Link to={`/api-analytics?key=${k.id}`}>
                                  <Button variant="outline" size="sm"><ChartColumn className="size-3.5" /> Analytics</Button>
                                </Link>
                                <Button variant="outline" size="sm" data-testid="duplicate" onClick={() => duplicate(k)}><Copy className="size-3.5" /> Duplicate settings</Button>
                                <Button variant="outline" size="sm" data-testid="revoke" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setPendingRevoke([k])}>
                                  <X className="size-3.5" /> Revoke
                                </Button>
                              </div>
                              <p className="text-[11px] text-muted-foreground">Keys can't be edited after creation. Duplicate opens the form pre-filled so you can replace this one.</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            {filtered && (
              <p className="px-4 py-2 text-[11px] text-muted-foreground border-t">Showing {visible.length} of {keys.length} keys.</p>
            )}
          </>
        )}
      </Card>

      <CreateKeyDialog
        key={createSession}
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaces={workspaces}
        initialDraft={createInitial}
        onCreated={(plainKey, draft) => { setCreated({ plainKey, draft }); onChanged(); }}
      />

      {/* Confirm revoke - the old X deleted instantly; a key is the one thing
          here you can't get back. */}
      <Dialog open={pendingRevoke !== null} onOpenChange={(o) => { if (!o) setPendingRevoke(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{pendingRevoke?.length === 1 ? `Revoke ${pendingRevoke[0].name}?` : `Revoke ${pendingRevoke?.length ?? 0} keys?`}</DialogTitle>
            <DialogDescription>Anything still using {pendingRevoke?.length === 1 ? 'it' : 'them'} stops working immediately. This can't be undone.</DialogDescription>
          </DialogHeader>
          {pendingRevoke && pendingRevoke.length > 1 && (
            <ul className="text-xs text-muted-foreground space-y-0.5 max-h-40 overflow-y-auto">
              {pendingRevoke.map((k) => <li key={k.id}>{k.name} <span className="font-mono">dos_····{k.key_prefix.slice(0, 4)}</span></li>)}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRevoke(null)}>Cancel</Button>
            <Button variant="destructive" data-testid="confirm-revoke" onClick={revoke} disabled={revoking}>
              {revoking ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null} Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The new key, shown once */}
      <Dialog open={created !== null} onOpenChange={(o) => { if (!o) setCreated(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{created?.draft.name.trim() || 'Your key'} is ready</DialogTitle>
            <DialogDescription>This is the only time the key is shown. Copy it now.</DialogDescription>
          </DialogHeader>
          {created && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <code data-testid="plain-key" className="flex-1 text-xs bg-muted px-3 py-2 rounded-md break-all font-mono">{created.plainKey}</code>
                <Button variant="outline" size="sm" onClick={copyKey} aria-label="Copy key"><CopyCheck copied={copied} className="size-3.5" /> Copy</Button>
              </div>
              <p className="text-xs leading-relaxed rounded-lg bg-muted px-3 py-2.5">
                {describeDraft(created.draft, workspaces).map((s, i) => s.strong ? <b key={i} className="font-semibold">{s.text}</b> : <span key={i}>{s.text}</span>)}
              </p>
              <div>
                <p className="text-xs font-medium mb-1.5">Use it</p>
                <pre className="text-[11px] bg-muted px-3 py-2 rounded-md overflow-x-auto font-mono leading-relaxed">{`curl ${API_HOST}/api/me \\\n  -H "Authorization: Bearer ${created.plainKey}"`}</pre>
              </div>
            </div>
          )}
          <DialogFooter><Button onClick={() => setCreated(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* S3 credentials */}
      <Dialog open={s3Open} onOpenChange={setS3Open}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>S3 credentials</DialogTitle></DialogHeader>
          {s3Loading || !s3Creds ? (
            <div className="py-8 flex items-center justify-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Use these with any S3-compatible client. The secret is shown only once.</p>
              <S3Field label="Access key ID" value={s3Creds.access_key_id} copyable />
              <S3Field label="Secret access key" value={s3Creds.secret_access_key} copyable={!s3Creds.secret_access_key.startsWith('(')} />
              <S3Field label="Endpoint" value={s3Creds.endpoint} copyable />
              <S3Field label="Region" value={s3Creds.region} copyable />
            </div>
          )}
          <DialogFooter><Button onClick={() => setS3Open(false)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Stat({ n, label, tone, title }: { n: number; label: string; tone?: 'warn'; title?: string }) {
  return (
    <span className="flex items-baseline gap-1.5" title={title}>
      <b className={`text-[15px] font-semibold tabular-nums ${tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : ''}`}>{n}</b>{' '}
      <span className="text-[11.5px] text-muted-foreground">{label}</span>
    </span>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{children}</p>;
}

function Row({ k, v, title }: { k: string; v: string; title?: string }) {
  return (
    <div className="flex justify-between gap-3 text-[11.5px]">
      <dt className="text-muted-foreground shrink-0">{k}</dt>
      <dd className="font-medium text-right min-w-0 break-words" title={title}>{v}</dd>
    </div>
  );
}

function S3Field({ label, value, copyable }: { label: string; value: string; copyable: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-[11px] bg-muted px-2.5 py-1.5 rounded-md break-all font-mono">{value}</code>
        {copyable && (
          <Button variant="outline" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={copy}>
            <CopyCheck copied={copied} className="size-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
