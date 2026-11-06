import { formatDateWith, formatNumber } from '@/lib/format-locale';
import { currentLocale, useT } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';
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

interface S3Creds { access_key_id: string; secret_access_key: string; endpoint: string; region: string; /** False when the secret field holds a note instead of a key. */ secret_available?: boolean }

// Keys, translated at render.
const SCOPE_FILTER_KEYS: { value: string; labelKey: MessageKey }[] = [
  { value: 'all', labelKey: 'profile.label.anyPermission' },
  { value: 'full', labelKey: 'profile.label.fullAccess' },
  { value: 'read', labelKey: 'profile.label.readOnly' },
  { value: 'upload', labelKey: 'profile.label.uploadOnly' },
];

/** TODO(catalog): "any address" -> "Any address", the catalog holds the lower-case form only; languages with other casing rules may read oddly. */
function capitalised(s: string): string {
  return s.charAt(0).toLocaleUpperCase(currentLocale()) + s.slice(1);
}

function shortDate(ts: number): string {
  return formatDateWith(ts, { month: 'short', day: 'numeric', year: 'numeric' }, 'en-US');
}

// Profile → API keys. A console, not a card list: a summary strip that says
// what needs attention, a toolbar to find a key, and rows that expand into
// the key's full configuration instead of truncating it into eight columns.
// Keys can't be edited (the API is create + delete only), so every action
// is revoke, duplicate, or look.
export function ApiKeysSection({ keys, workspaces, onChanged }: { keys: ApiKey[]; workspaces: WorkspaceRef[]; onChanged: () => void }) {
  const t = useT();
  const scopeFilterItems = SCOPE_FILTER_KEYS.map((o) => ({ value: o.value, label: t(o.labelKey) }));
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
        return [id, res.ok && res.folder ? res.folder.name : t('file-requests.label.unknownFolder')] as const;
      }));
      if (!cancelled) setFolderNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    })();
    return () => { cancelled = true; };
  }, [keys, folderNames, t]);

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
      toast.success(pendingRevoke.length === 1 ? t('common.feedback.keyRevoked') : t('profile.feedback.pendingrevokecountKeysRevoked', { pendingRevokeCount: pendingRevoke.length }), t('profile.feedback.anythingStillUsingThemWillBeRefusedFromNowOn'));
    } else {
      toast.error(t('common.error.revokeFailed'), results.find((r) => !r.ok)?.error ?? t('profile.error.failedOfPendingrevokecountKeysCouldNotBeRevoked', { failed, pendingRevokeCount: pendingRevoke.length }));
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
    else { toast.error(t('profile.error.couldNotEnableS3'), res.error ?? t('profile.error.s3AccessCouldNotBeEnabled')); setS3Open(false); }
    setS3Loading(false);
  };

  const viewS3 = (k: ApiKey) => {
    if (!k.s3_access_key_id) return;
    setS3Creds({
      access_key_id: k.s3_access_key_id,
      secret_access_key: t('profile.description.secretKeyIsNotRetrievableRevokeAndRecreateTheKey'),
      secret_available: false,
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
      <h2 className="text-base font-semibold mb-3">{t('profile.heading.apiKeys')}</h2>
      <Card className="py-0 gap-0 overflow-hidden">
        {/* Summary strip */}
        <div className="flex items-center gap-x-5 gap-y-2 flex-wrap px-4 py-3 border-b" data-testid="summary-strip">
          <CountStat n={summary.total} text={t('profile.label.countPluralOneKeyOtherKeys', { count: summary.total })} />
          {summary.unrestricted > 0 && <Stat n={summary.unrestricted} label={t('profile.label.unrestricted')} tone="warn" title={t('profile.tooltip.fullAccessToTheWholeAccountFromAnywhereNeverExpires')} />}
          {summary.stale > 0 && <Stat n={summary.stale} label={t('profile.label.unusedFor90Days')} tone="warn" />}
          {summary.expiringSoon > 0 && <Stat n={summary.expiringSoon} label={t('profile.label.expiringWithin30Days')} />}
          <span className="flex-1" />
          <Button size="sm" data-testid="new-key" onClick={openNew}><Plus className="size-3.5" /> {t('profile.action.newApiKey')}</Button>
        </div>

        {keys.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm font-medium">{t('profile.label.noApiKeysYet')}</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[40ch] mx-auto">{t('profile.description.aKeyLetsAnAppOrAScriptReachYourFiles')}</p>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b">
              <label className="flex items-center gap-2 flex-1 min-w-40 h-8 px-2.5 rounded-lg border text-muted-foreground focus-within:border-ring">
                <Search className="size-3.5 shrink-0" />
                <input
                  data-testid="key-search" aria-label={t('profile.accessibility.searchKeys')} placeholder={t('profile.placeholder.searchNameOrPrefix')}
                  value={q} onChange={(e) => setQ(e.target.value)}
                  className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
                />
              </label>
              <Select value={scopeFilter} onValueChange={(v) => setScopeFilter((v as string) ?? 'all')} items={scopeFilterItems}>
                <SelectTrigger className="h-8 text-xs w-auto min-w-36" aria-label={t('profile.accessibility.filterByPermission')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {scopeFilterItems.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                variant="outline" size="sm" data-testid="filter-unrestricted" aria-pressed={unrestrictedOnly}
                onClick={() => setUnrestrictedOnly((v) => !v)}
                className={unrestrictedOnly ? 'border-amber-600/60 text-amber-700 dark:text-amber-400' : ''}
              >
                {t('profile.action.unrestrictedOnly')}
              </Button>
              {selected.size > 0 && (
                <>
                  <span className="flex-1" />
                  <Button
                    variant="outline" size="sm" data-testid="bulk-revoke"
                    className="text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => setPendingRevoke(selectedKeys)}
                  >
                    <X className="size-3.5" /> {t('profile.action.revokeSelectedsize', { selectedSize: selected.size })}
                  </Button>
                </>
              )}
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-[28px_1.5fr_0.8fr_1fr_1.1fr_0.9fr_32px] gap-3 items-center px-4 pb-2 pt-2.5 border-b">
                  <span><span className="sr-only">{t('profile.label.select')}</span></span>
                  {(['common.label.name', 'common.label.permission', 'profile.label.protocols', 'common.label.reach', 'common.label.lastUsed'] as const).map((h) => (
                    <span key={h} className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t(h)}</span>
                  ))}
                  <span />
                </div>

                {visible.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">{t('profile.description.noKeysMatch')}</p>
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
                          data-testid="key-select" aria-label={t('common.accessibility.selectName', { name: k.name })} className="size-4"
                          checked={selected.has(k.id)} onCheckedChange={() => toggleSelected(k.id)}
                        />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[13px] font-medium truncate" dir="auto">{k.name}</span>
                            {expired ? <Badge variant="secondary" className="text-[10px] font-medium text-destructive shrink-0">{t('common.status.expired')}</Badge>
                              : k.expires_at !== null ? <Badge variant="secondary" className="text-[10px] font-medium shrink-0">{t('profile.status.expiresKexpiresAt', { date: shortDate(k.expires_at) })}</Badge> : null}
                          </span>
                          <span dir="ltr" className="block text-[11px] text-muted-foreground font-mono">dos_····{k.key_prefix.slice(0, 4)}</span>
                        </span>
                        <span><Badge variant={k.scope === 'full' ? 'default' : 'secondary'} className="text-[10px]">{SCOPE_LABELS[k.scope] ?? k.scope}</Badge></span>
                        <span className="text-[11.5px] text-muted-foreground truncate" title={formatSurfaces(k.surfaces)}>{formatSurfaces(k.surfaces)}</span>
                        <span className="min-w-0">
                          <span className="block text-[11.5px] text-muted-foreground truncate" title={formatAnchor(k, workspaces, folderNames)}>{formatAnchor(k, workspaces, folderNames)}</span>
                          {(ipCount > 0 || k.active_hours) && (
                            <span className="flex gap-1 mt-0.5">
                              {ipCount > 0 && <Badge variant="secondary" className="text-[9.5px] font-medium">{t('profile.status.ipcountPluralOneIpRangeOtherIpRanges', { ipCount })}</Badge>}
                              {k.active_hours && <Badge variant="secondary" className="text-[9.5px] font-medium">{t('profile.status.setHours')}</Badge>}
                            </span>
                          )}
                        </span>
                        <span
                          data-testid="last-used" data-stale={stale ? 'true' : undefined}
                          title={stale ? t('profile.tooltip.notUsedIn90DaysIfNothingNeedsItRevokeIt') : undefined}
                          className={stale
                            ? 'inline-flex w-fit items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'text-[11.5px] text-muted-foreground'}
                        >
                          {formatLastUsed(k, now)}
                        </span>
                        <button
                          type="button" data-testid="key-expand" aria-expanded={open} aria-label={t('profile.action.openSelectTrueCollapseOtherExpandKname', { open: String(open), kName: k.name })}
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
                              <Heading>{t('profile.label.configuration')}</Heading>
                              <Row k={t('common.label.permission')} v={SCOPE_LABELS[k.scope] ?? k.scope} />
                              <Row k={t('profile.label.protocols')} v={formatSurfaces(k.surfaces)} />
                              <Row k={t('common.label.reach')} v={formatAnchor(k, workspaces, folderNames)} />
                              <Row k={t('common.label.created')} v={shortDate(k.created_at)} />
                              <Row k={t('common.label.expires')} v={k.expires_at === null ? t('common.label.never') : expired ? `${t('common.status.expired')} ${shortDate(k.expires_at)}` : shortDate(k.expires_at)} />
                            </dl>
                            <dl className="space-y-1.5">
                              <Heading>{t('profile.label.guards')}</Heading>
                              <Row k={t('settings.label.ipAllowlist')} v={ipCount === 0 ? capitalised(t('profile.label.anyAddress')) : t('profile.label.ranges', { count: ipCount })} title={k.allowed_ips ?? undefined} />
                              <Row k={t('profile.label.activeHours')} v={k.active_hours ? formatActiveHours(k.active_hours) : t('profile.label.anyTime')} />
                              <Row k={t('common.label.lastUsed')} v={formatLastUsed(k, now)} />
                              <div className="flex justify-between gap-3 text-[11.5px]">
                                <dt className="text-muted-foreground">{t('profile.label.s3Credentials')}</dt>
                                <dd className="font-medium text-end" data-testid="s3-status">
                                  {k.s3_access_key_id ? (
                                    <button type="button" data-testid="s3-show" onClick={() => viewS3(k)} className="text-green-700 dark:text-green-400 hover:underline underline-offset-2">{t('profile.action.activeShow')}</button>
                                  ) : expired ? (
                                    <span title={t('profile.tooltip.thisKeyHasExpiredCreateANewKeyToUseS3')} className="text-muted-foreground">{t('common.status.expired')}</span>
                                  ) : keyAllowsS3(k.surfaces) ? (
                                    <button type="button" data-testid="s3-enable" onClick={() => enableS3(k.id)} className="hover:underline underline-offset-2">{t('profile.action.enable')}</button>
                                  ) : (
                                    <span title={t('profile.tooltip.thisKeySProtocolsDonTIncludeTheS3GatewayCreateAKey')} className="text-muted-foreground">{t('profile.error.notAllowed')}</span>
                                  )}
                                </dd>
                              </div>
                            </dl>
                            <div className="space-y-2">
                              <Heading>{t('common.label.actions')}</Heading>
                              <div className="flex flex-wrap gap-1.5">
                                <Link to={`/api-analytics?key=${k.id}`}>
                                  <Button variant="outline" size="sm"><ChartColumn className="size-3.5" /> {t('profile.action.analytics')}</Button>
                                </Link>
                                {k.scope !== 'wp_site' && (
                                  <Button variant="outline" size="sm" data-testid="duplicate" onClick={() => duplicate(k)}><Copy className="size-3.5" /> {t('profile.action.duplicateSettings')}</Button>
                                )}
                                <Button variant="outline" size="sm" data-testid="revoke" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setPendingRevoke([k])}>
                                  <X className="size-3.5" /> {t('common.action.revoke')}
                                </Button>
                              </div>
                              {k.scope === 'wp_site' ? (
                                <p data-testid="wp-site-note" className="text-[11px] text-muted-foreground">{t('profile.description.thisKeyBelongsToAConnectedWordpressSiteDisconnectTheSite')}</p>
                              ) : (
                                <p className="text-[11px] text-muted-foreground">{t('profile.error.keysCanTBeEditedAfterCreationDuplicateOpensTheFormPreFilled')}</p>
                              )}
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
              <p className="px-4 py-2 text-[11px] text-muted-foreground border-t">{t('profile.description.showingVisiblecountOfKeyscountKeys', { visibleCount: visible.length, keysCount: keys.length })}</p>
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
            <DialogTitle>{pendingRevoke?.length === 1 ? t('profile.heading.revokeName', { name: pendingRevoke[0].name }) : t('profile.heading.revokePendingrevokelengthKeys', { pendingRevokeLength: pendingRevoke?.length ?? 0 })}</DialogTitle>
            <DialogDescription>{t('profile.error.anythingStillUsingPendingrevokecountPluralOneItOtherThemStopsWorking', { pendingRevokeCount: pendingRevoke?.length ?? 0 })}</DialogDescription>
          </DialogHeader>
          {pendingRevoke && pendingRevoke.length > 1 && (
            <ul className="text-xs text-muted-foreground space-y-0.5 max-h-40 overflow-y-auto">
              {pendingRevoke.map((k) => <li key={k.id}><bdi>{k.name}</bdi> <span dir="ltr" className="font-mono">dos_····{k.key_prefix.slice(0, 4)}</span></li>)}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRevoke(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" data-testid="confirm-revoke" onClick={revoke} disabled={revoking}>
              {revoking ? <Loader2 className="size-4 animate-spin me-1.5" /> : null} {t('common.action.revoke')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The new key, shown once */}
      <Dialog open={created !== null} onOpenChange={(o) => { if (!o) setCreated(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('profile.heading.createddraftnameIsReady', { createdDraftName: created?.draft.name.trim() || t('profile.label.yourKey') })}</DialogTitle>
            <DialogDescription>{t('common.description.thisIsTheOnlyTimeTheKeyIsShownCopyIt')}</DialogDescription>
          </DialogHeader>
          {created && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <code dir="ltr" data-testid="plain-key" className="flex-1 text-xs bg-muted px-3 py-2 rounded-md break-all font-mono">{created.plainKey}</code>
                <Button variant="outline" size="sm" onClick={copyKey} aria-label={t('common.action.copyKey')}><CopyCheck copied={copied} className="size-3.5" /> {t('common.copy')}</Button>
              </div>
              <p className="text-xs leading-relaxed rounded-lg bg-muted px-3 py-2.5">
                {describeDraft(created.draft, workspaces).map((s, i) => s.strong ? <b key={i} className="font-semibold">{s.text}</b> : <span key={i}>{s.text}</span>)}
              </p>
              <div>
                <p className="text-xs font-medium mb-1.5">{t('profile.label.useIt')}</p>
                <pre dir="ltr" className="text-[11px] bg-muted px-3 py-2 rounded-md overflow-x-auto font-mono leading-relaxed">{`curl ${API_HOST}/api/me \\\n  -H "Authorization: Bearer ${created.plainKey}"`}</pre>
              </div>
            </div>
          )}
          <DialogFooter><Button onClick={() => setCreated(null)}>{t('common.done')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* S3 credentials */}
      <Dialog open={s3Open} onOpenChange={setS3Open}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t('profile.heading.s3Credentials')}</DialogTitle></DialogHeader>
          {s3Loading || !s3Creds ? (
            <div className="py-8 flex items-center justify-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{t('profile.description.useTheseWithAnyS3CompatibleClientTheSecretIsShownOnly')}</p>
              <S3Field label={t('profile.label.accessKeyId')} value={s3Creds.access_key_id} copyable />
              <S3Field label={t('profile.label.secretAccessKey')} value={s3Creds.secret_access_key} copyable={s3Creds.secret_available !== false} />
              <S3Field label={t('profile.label.endpoint')} value={s3Creds.endpoint} copyable />
              <S3Field label={t('common.label.region')} value={s3Creds.region} copyable />
            </div>
          )}
          <DialogFooter><Button onClick={() => setS3Open(false)}>{t('common.done')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** TODO(catalog): the count message carries its own number; this bolds it where the text starts with it. A count whose catalog message already carries the number: the number is set bold where the text starts with it. */
function CountStat({ n, text }: { n: number; text: string }) {
  const figure = formatNumber(n);
  if (!text.startsWith(figure)) return <span className="text-[11.5px] text-muted-foreground">{text}</span>;
  return <Stat n={figure} label={text.slice(figure.length).trim()} />;
}

function Stat({ n, label, tone, title }: { n: number | string; label: string; tone?: 'warn'; title?: string }) {
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
      <dd className="font-medium text-end min-w-0 break-words" title={title}>{v}</dd>
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
        <code dir="ltr" className="flex-1 text-[11px] bg-muted px-2.5 py-1.5 rounded-md break-all font-mono">{value}</code>
        {copyable && (
          <Button variant="outline" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={copy}>
            <CopyCheck copied={copied} className="size-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
