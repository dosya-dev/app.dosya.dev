import { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api, apiErrorMessage } from '@/api/client';
import { useDocumentTitle } from '@/lib/page-title';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { CopyCheck } from '@/components/ui/copy-check';
import {
  ChevronLeft, Globe, Lock, Clock, Download, Eye, ShieldAlert, Shield, X,
  Monitor, Smartphone, Tablet, Check, Share2, CircleDashed, TriangleAlert,
} from 'lucide-react';
import { humanSize, timeAgo, timeUntil, colorFor, labelFor } from '@/lib/helpers';
import { toast } from '@/lib/toast';

// ── Types ──────────────────────────────────────────────────

type Range = 7 | 30 | 90;
type EventFilter = 'all' | 'view' | 'download';

interface LinkMeta {
  link_id: string; url: string; display_name: string;
  is_folder: boolean; is_bundle: boolean;
  size_bytes: number | null; extension: string | null; region: string | null;
  created_at: number; created_by: string; created_by_name: string | null; is_mine: boolean;
  expires_at: number | null; is_revoked: boolean; revoked_at: number | null;
  is_password_protected: boolean; lock_mode: string; access_mode: string;
  status: 'active' | 'expiring' | 'expired' | 'revoked';
  view_count: number; download_count: number;
}
interface Bucket { day: string; opens: number; downloads: number }
interface Ranked { label: string; count: number }
interface Recipient { email: string; verified_at: number | null; invited_at: number }
interface LogRow {
  id: string; visitor: string; event: 'view' | 'download';
  device: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  device_label: string; viewed_at: number;
}
interface Analytics {
  ok: boolean;
  link: LinkMeta;
  range: Range;
  timeline: Bucket[];
  reach: { visitors: number; truncated: boolean; devices: Ranked[]; browsers: Ranked[] };
  recipients: Recipient[] | null;
  log: { total: number; offset: number; limit: number; rows: LogRow[] };
  gaps: { country: string; repeat_visits: string; per_recipient: string | null };
}

const DEVICE_ICON = { desktop: Monitor, mobile: Smartphone, tablet: Tablet, unknown: Monitor };

/* Not exported: this page is the only consumer, and exporting a non-component
   from a route module breaks react-refresh. Invalidation elsewhere targets the
   ['share-analytics', id] prefix rather than importing this. */
const shareAnalyticsKey = (id: string, range: Range) => ['share-analytics', id, range];

// ── Page ───────────────────────────────────────────────────

export default function ShareAnalyticsPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<Range>(30);
  const [evFilter, setEvFilter] = useState<EventFilter>('all');
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const query = useQuery({
    queryKey: shareAnalyticsKey(id, range),
    queryFn: () => api<Analytics>(`/api/shares/${id}/analytics?range=${range}`),
    enabled: !!id,
  });

  const data = query.data;
  useDocumentTitle(data ? `${data.link.display_name} - Shared` : 'Shared');

  const copyUrl = async () => {
    if (!data) return;
    await navigator.clipboard.writeText(data.link.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const revoke = async () => {
    try {
      await api(`/api/shares/${id}/revoke`, { method: 'POST' });
      setConfirmRevoke(false);
      toast.success('Link revoked', 'The share link no longer works.');
      queryClient.invalidateQueries({ queryKey: ['share-analytics', id] });
      queryClient.invalidateQueries({ queryKey: ['shares'] });
    } catch (err) {
      toast.error('Revoke failed', apiErrorMessage(err, 'The share link could not be revoked.'));
    }
  };

  if (query.isLoading) return <AnalyticsSkeleton />;

  if (query.isError || !data) {
    return (
      <div className="px-8 py-7">
        <BackLink />
        <EmptyState
          icon={Share2}
          title="This share link is not available"
          description={apiErrorMessage(query.error, 'It may have been deleted, or you may not have permission to view it.')}
          actions={<Button size="sm" className="h-7 text-xs" onClick={() => navigate('/shared')}>Back to Shared</Button>}
        />
      </div>
    );
  }

  const { link, timeline, reach, recipients, log, gaps } = data;
  const dead = link.is_revoked;
  const restricted = link.access_mode === 'restricted';
  const hasTraffic = link.view_count > 0 || link.download_count > 0;
  const logRows = log.rows.filter((r) => evFilter === 'all' || r.event === evFilter);

  return (
    <div className="px-8 pt-7 pb-14 max-w-[1400px]">
      <BackLink />

      {/* ── Header ── */}
      <div className="flex items-start gap-5 flex-wrap mt-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-[42px] h-[42px] rounded-xl flex items-center justify-center text-[10px] font-bold text-white shrink-0"
            style={{ background: colorFor(link.display_name) }}
          >
            {labelFor(link.display_name)}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight leading-tight break-words">{link.display_name}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {link.size_bytes != null && <>{humanSize(link.size_bytes)} &middot; </>}
              {link.region && <>{link.region} &middot; </>}
              shared by {link.is_mine ? 'you' : (link.created_by_name ?? 'a teammate')} {timeAgo(link.created_at)}
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <StatusPill status={link.status} />
          {!dead && (
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={copyUrl}>
              <CopyCheck copied={copied} className="size-3" checkClassName="text-green-600" />
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          )}
          {dead ? (
            <Link to="/files">
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                <Share2 className="size-3" /> Create a new link
              </Button>
            </Link>
          ) : (
            <Button
              variant="outline" size="sm"
              className="h-8 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => setConfirmRevoke(true)}
            >
              <X className="size-3" /> Revoke
            </Button>
          )}
        </div>
      </div>

      {/* ── URL bar ── */}
      <div className="flex items-center gap-2.5 flex-wrap mt-4 px-3 py-2 border rounded-t-xl border-b-0 bg-card text-xs">
        <Globe className="size-3.5 text-muted-foreground shrink-0" />
        <code className="font-mono font-bold tracking-tight break-all">{link.url.replace(/^https?:\/\//, '')}</code>
        <span className="w-px h-3.5 bg-border hidden sm:block" />
        <span className="text-muted-foreground">
          {dead ? 'This link no longer works'
            : restricted ? `Restricted to ${recipients?.length ?? 0} invited addresses`
            : 'Open to anyone with the URL'}
        </span>
      </div>
      <div className="border-b" />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_316px] gap-5 mt-5 items-start">
        <div className="flex flex-col gap-5 min-w-0">

          {/* ── 1. Exposure ── */}
          <section className="bg-card border rounded-2xl p-6">
            {/* Display scale, on the ramp: 30px against the 20px h1 above is the
                same 1.5x the design called for, without inventing a type step. */}
            <p className="text-2xl sm:text-3xl font-medium tracking-[-0.028em] leading-[1.24] max-w-[30ch] text-balance">
              <ExposureLine link={link} reach={reach} recipients={recipients} />
            </p>
            <p className="text-xs text-muted-foreground mt-3 max-w-[68ch]">
              {restricted
                ? 'Counted by verified recipient, not by address. Each person proved control of their inbox with a one-time code before any byte of the file was served.'
                : 'A person is counted once, by a hashed IP address. dosya.dev stores the hash, never the address itself, and cannot recover one from the other.'}
            </p>

            <GuardRail link={link} recipients={recipients} />
          </section>

          {/* ── 2. Access over time ── */}
          <section className="bg-card border rounded-2xl p-6">
            <div className="flex items-start gap-4 flex-wrap mb-5">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight">Access over time</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {hasTraffic ? `First opens and downloads, by day · last ${range} days` : 'Nothing recorded yet'}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-3 flex-wrap">
                {hasTraffic && (
                  <div className="flex gap-3 items-center">
                    <Legend swatch="var(--share-opens)" label="First opens" />
                    <Legend swatch="var(--share-downloads)" label="Downloads" />
                  </div>
                )}
                <Segmented
                  value={range}
                  onChange={(v) => setRange(v)}
                  disabled={!hasTraffic}
                  options={[{ value: 7 as Range, label: '7d' }, { value: 30 as Range, label: '30d' }, { value: 90 as Range, label: '90d' }]}
                />
              </div>
            </div>

            {timeline.length === 0 ? (
              <div className="border rounded-xl bg-muted/40 py-14 px-5 text-center">
                <p className="text-xs text-muted-foreground">
                  {hasTraffic
                    ? `No opens in the last ${range} days. Try a wider range.`
                    : 'Nothing to chart yet. The first open will appear here within a minute.'}
                </p>
              </div>
            ) : (
              <TimelineChart timeline={timeline} link={link} range={range} />
            )}

            <p className="flex gap-2 items-start mt-4 pt-3.5 border-t text-xs text-muted-foreground max-w-[80ch]">
              <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
              <span>
                A person who returns is not counted a second time, so this chart shows{' '}
                <b className="text-foreground font-semibold">first</b> opens, not visits. {gaps.repeat_visits}.
              </span>
            </p>
          </section>

          {/* ── 3. Access log ── */}
          <section className="bg-card border rounded-2xl overflow-hidden">
            <div className="flex items-start gap-4 flex-wrap p-5 pb-3.5">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight">Access log</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Every open and download, newest first</p>
              </div>
              {log.total > 0 && (
                <div className="ml-auto">
                  <Segmented
                    value={evFilter}
                    onChange={setEvFilter}
                    options={[
                      { value: 'all' as EventFilter, label: 'All' },
                      { value: 'view' as EventFilter, label: 'Opens' },
                      { value: 'download' as EventFilter, label: 'Downloads' },
                    ]}
                  />
                </div>
              )}
            </div>

            {log.total === 0 ? (
              <div className="border-t px-6 pt-12 pb-11 flex flex-col items-center text-center gap-1.5">
                <Eye className="size-5 text-muted-foreground opacity-60 mb-1" />
                <p className="text-sm font-semibold">No one has opened this link</p>
                <p className="text-xs text-muted-foreground max-w-[44ch]">
                  Send the URL to someone. Every open and download will be listed here with the
                  device it came from.
                </p>
                {!dead && (
                  <Button variant="outline" size="sm" className="h-7 text-xs mt-3 gap-1.5" onClick={copyUrl}>
                    <CopyCheck copied={copied} className="size-3" checkClassName="text-green-600" />
                    Copy link
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table className="min-w-[560px]">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        {['When', 'Event', 'Visitor', 'Device'].map((h) => (
                          <TableHead
                            key={h}
                            className="h-auto text-[10px] font-bold uppercase tracking-wider text-muted-foreground py-2.5 px-4 bg-muted/40 border-t"
                          >
                            {h}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logRows.map((r) => {
                        const Icon = DEVICE_ICON[r.device] ?? Monitor;
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="py-2.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                              {timeAgo(r.viewed_at)}
                            </TableCell>
                            <TableCell className="py-2.5 px-4 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">
                                {r.event === 'download'
                                  ? <Download className="size-3.5 text-[var(--share-downloads)]" />
                                  : <Eye className="size-3.5 text-muted-foreground" />}
                                {r.event === 'download' ? 'Downloaded' : 'Opened'}
                              </span>
                            </TableCell>
                            <TableCell className="py-2.5 px-4 font-mono text-xs whitespace-nowrap">{r.visitor}</TableCell>
                            <TableCell className="py-2.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                              <span className="inline-flex items-center gap-2">
                                <Icon className="size-3.5 shrink-0" />{r.device_label}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center gap-3 px-5 py-3 border-t text-xs text-muted-foreground">
                  <p>Showing {logRows.length} of {log.total} events</p>
                </div>
              </>
            )}
          </section>
        </div>

        {/* ── Right rail ── */}
        <aside className="flex flex-col gap-5 min-w-0">
          <section className="bg-card border rounded-2xl p-[18px]">
            <RailHeading>Link controls</RailHeading>
            <dl className="text-xs">
              <ControlRow icon={Clock} label={dead ? 'Ended' : 'Expires'}>
                {dead ? `Revoked ${timeAgo(link.revoked_at ?? link.created_at)}`
                  : link.expires_at ? timeUntil(link.expires_at) : 'Never'}
              </ControlRow>
              <ControlRow icon={Globe} label="Access">
                {restricted ? `${recipients?.length ?? 0} invited people` : 'Anyone with the link'}
              </ControlRow>
              <ControlRow icon={Lock} label="Password" warn={!link.is_password_protected}>
                {link.is_password_protected ? 'Set' : 'Not set'}
              </ControlRow>
              <ControlRow icon={Download} label="Downloads" last>
                {link.lock_mode === 'view_only' ? 'View only' : 'Allowed'}
              </ControlRow>
            </dl>
            <p className="text-[11px] text-muted-foreground mt-3.5 pt-3 border-t">
              Created by {link.is_mine ? 'you' : (link.created_by_name ?? 'a teammate')} {timeAgo(link.created_at)}
            </p>
          </section>

          {restricted && recipients && (
            <section className="bg-card border rounded-2xl p-[18px]">
              <RailHeading count={recipients.length}>Invited</RailHeading>
              <ul>
                {recipients.map((r) => (
                  <li key={r.email} className="flex items-center gap-2.5 py-1.5 text-xs">
                    <span className={`w-6 h-6 rounded-full bg-muted text-muted-foreground grid place-items-center text-[9px] font-bold shrink-0 ${r.verified_at ? '' : 'opacity-50'}`}>
                      {recipientInitials(r.email)}
                    </span>
                    <span className={`flex-1 min-w-0 truncate ${r.verified_at ? '' : 'text-muted-foreground'}`}>{r.email}</span>
                    <span className={`text-[10px] inline-flex items-center gap-1 shrink-0 ${r.verified_at ? 'text-primary' : 'text-muted-foreground'}`}>
                      {r.verified_at ? <><Check className="size-3" />Verified</> : 'Not opened'}
                    </span>
                  </li>
                ))}
              </ul>
              {/*
                The one thing this panel cannot say. share_views has no
                recipient column and the grant cookie does not name which
                address verified, so an individual event is not attributable to
                a person even here. Marked rather than faked.
              */}
              {gaps.per_recipient && (
                <p className="flex gap-1.5 items-start text-[11px] text-muted-foreground mt-3 pt-3 border-t border-dashed leading-relaxed">
                  <CircleDashed className="size-3 mt-0.5 shrink-0" />
                  <span>Verification is per person, but individual opens in the log are not: {gaps.per_recipient}.</span>
                </p>
              )}
            </section>
          )}

          {reach.visitors > 0 && (
            <section className="bg-card border rounded-2xl p-[18px] bg-muted/30">
              <RailHeading count={reach.visitors}>Who reached it</RailHeading>
              <BarList caption="Device" rows={reach.devices} total={reach.visitors} icons />
              <BarList caption="Browser" rows={reach.browsers} total={reach.visitors} />
              {reach.truncated && (
                <p className="text-[11px] text-muted-foreground mb-4 -mt-2">
                  Counted from the first 5,000 visitors.
                </p>
              )}
              {/*
                Country is a decision, not a backlog item: this product leads on
                not tracking people, and a share-link visitor never agreed to
                anything. The panel says what is missing and what it would cost,
                and stops there.
              */}
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground mt-5 pt-4 border-t border-dashed">
                Country
                <span className="inline-flex items-center gap-1 border border-dashed rounded-full px-2 py-px text-[10px] font-semibold normal-case">
                  <CircleDashed className="size-2.5" />not tracked
                </span>
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed mt-2">
                Not recorded, and not a foregone conclusion. Cloudflare hands the worker a two-letter
                country on every request, so the cost is one column on <code className="bg-muted rounded px-1">share_views</code>.
                Whether to take it is a separate question: dosya.dev leads on not tracking people, and a
                visitor to a share link never agreed to anything.
              </p>
            </section>
          )}
        </aside>
      </div>

      <Dialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <DialogContent className="max-w-sm text-center">
          <DialogHeader><DialogTitle>Revoke this link</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Anyone holding the link to <span className="font-semibold text-foreground">{link.display_name}</span> loses
            access the moment you confirm. The access log is kept. This cannot be undone.
          </p>
          <DialogFooter className="justify-center">
            <Button variant="outline" onClick={() => setConfirmRevoke(false)}>Cancel</Button>
            <Button variant="destructive" onClick={revoke}>Revoke link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────

/** Two letters from an address, skipping the punctuation that slice() catches. */
function recipientInitials(email: string): string {
  const local = email.split('@')[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1
    ? (parts[0][0] ?? '') + (parts[1][0] ?? '')
    : local.replace(/[^a-z0-9]/gi, '').slice(0, 2);
  return (letters || email.slice(0, 2)).toUpperCase();
}

function BackLink() {
  return (
    <Link to="/shared" className="inline-flex items-center gap-1 -ml-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
      <ChevronLeft className="size-3.5" /> Shared
    </Link>
  );
}

/**
 * The headline. A sentence, not a stat tile - and a different sentence per
 * link type, because a public link and a private one genuinely know different
 * things about who opened them.
 */
function ExposureLine({ link, reach, recipients }: {
  link: LinkMeta; reach: { visitors: number }; recipients: Recipient[] | null;
}) {
  const dim = 'block text-muted-foreground';

  if (link.access_mode === 'restricted' && recipients) {
    const opened = recipients.filter((r) => r.verified_at).length;
    if (opened === 0) {
      return (
        <>
          None of the {recipients.length} people you invited have opened this link yet.
          <span className={dim}>No one else can.</span>
        </>
      );
    }
    return (
      <>
        <b className="font-bold">{opened}</b> of the <b className="font-bold">{recipients.length}</b> people
        you invited {opened === 1 ? 'has' : 'have'} opened this link.
        <span className={dim}>No one else can.</span>
      </>
    );
  }

  if (link.is_revoked) {
    return (
      <>
        <b className="font-bold">{reach.visitors}</b> {reach.visitors === 1 ? 'person' : 'people'} opened
        this link before you revoked it.
        <span className={dim}>It stopped working {timeAgo(link.revoked_at ?? link.created_at)}.</span>
      </>
    );
  }

  if (reach.visitors === 0) {
    return (
      <>
        No one has opened this link yet.
        <span className={dim}>You created it {timeAgo(link.created_at)}.</span>
      </>
    );
  }

  return (
    <>
      <b className="font-bold">{reach.visitors}</b> {reach.visitors === 1 ? 'person has' : 'people have'} opened
      this link.
      <span className={dim}>You do not know who they are.</span>
    </>
  );
}

/** The security payload: what is or is not protecting this file, with the fix in reach. */
function GuardRail({ link, recipients }: { link: LinkMeta; recipients: Recipient[] | null }) {
  const base = 'flex gap-3 items-start mt-5 px-4 py-3.5 border rounded-xl flex-wrap';

  if (link.is_revoked) {
    return (
      <div className={`${base} bg-muted/40`}>
        <X className="size-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="min-w-[220px] flex-1">
          <p className="text-[13px] font-semibold">
            Revoked {timeAgo(link.revoked_at ?? link.created_at)}
            {link.created_by_name && !link.is_mine ? ` by ${link.created_by_name}` : link.is_mine ? ' by you' : ''}.
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-[62ch]">
            The URL now returns 410 Gone. The record below is kept so the access history survives the link.
          </p>
        </div>
      </div>
    );
  }

  if (link.access_mode === 'restricted') {
    return (
      <div className={`${base} bg-muted/40`}>
        <Shield className="size-4 mt-0.5 text-primary shrink-0" />
        <div className="min-w-[220px] flex-1">
          <p className="text-[13px] font-semibold">
            This link is restricted to {recipients?.length ?? 0} invited addresses
            {link.is_password_protected ? ' and needs a password' : ''}.
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-[62ch]">
            A recipient proves control of their inbox with a one-time code before the file is served.
            A forwarded URL is useless on its own.
          </p>
        </div>
      </div>
    );
  }

  if (link.is_password_protected) {
    return (
      <div className={`${base} bg-muted/40`}>
        <Shield className="size-4 mt-0.5 text-primary shrink-0" />
        <div className="min-w-[220px] flex-1">
          <p className="text-[13px] font-semibold">This link is public but needs a password.</p>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-[62ch]">
            Anyone forwarded the URL still needs the password you set. Restricting it to named
            addresses is stronger, because a password can be forwarded too.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${base} border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40`}>
      <ShieldAlert className="size-4 mt-0.5 text-amber-600 dark:text-amber-500 shrink-0" />
      <div className="min-w-[220px] flex-1">
        <p className="text-[13px] font-semibold">This link is public and has no password.</p>
        <p className="text-xs text-muted-foreground mt-0.5 max-w-[62ch]">
          Anyone who is forwarded the URL can open and download the file, and that forward leaves
          no trace here.
        </p>
      </div>
    </div>
  );
}

function TimelineChart({ timeline, link, range }: { timeline: Bucket[]; link: LinkMeta; range: Range }) {
  // Recharts needs a label per bucket; the API returns ISO days.
  const data = useMemo(() => timeline.map((b) => ({
    ...b,
    label: new Date(`${b.day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  })), [timeline]);

  // The revoke moment, when it falls inside the window on show. Marking it is
  // what stops a revoked link's chart from reading as if it were still live.
  const revokedLabel = useMemo(() => {
    if (!link.is_revoked || !link.revoked_at) return null;
    const day = new Date(link.revoked_at * 1000).toISOString().slice(0, 10);
    return data.find((d) => d.day === day)?.label ?? null;
  }, [link.is_revoked, link.revoked_at, data]);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="2 4" />
        <XAxis
          dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--border)' }}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
          minTickGap={range === 90 ? 48 : 24}
        />
        <YAxis
          width={36} allowDecimals={false} tickLine={false} axisLine={false}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--muted)', opacity: 0.5 }} />
        {revokedLabel && (
          <ReferenceLine
            x={revokedLabel} stroke="var(--muted-foreground)" strokeDasharray="3 3"
            label={{ value: 'Revoked', position: 'insideTopRight', fill: 'var(--muted-foreground)', fontSize: 10 }}
          />
        )}
        <Bar dataKey="opens" name="First opens" fill="var(--share-opens)" radius={[2, 2, 0, 0]} maxBarSize={22} isAnimationActive={false} />
        <Bar dataKey="downloads" name="Downloads" fill="var(--share-downloads)" radius={[2, 2, 0, 0]} maxBarSize={22} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: { name: string; value: number; fill?: string }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-sm text-xs">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-[2px]" style={{ background: p.fill }} />
          {p.name}: <span className="font-medium text-foreground font-mono">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <i className="size-2.5 rounded-[2px] block" style={{ background: swatch }} />{label}
    </span>
  );
}

function Segmented<T extends string | number>({ value, onChange, options, disabled }: {
  value: T; onChange: (v: T) => void; disabled?: boolean;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex bg-muted rounded-[10px] p-0.5 gap-0.5" role="group">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none ${
            value === o.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: LinkMeta['status'] }) {
  const tone = status === 'active' ? 'bg-green-500'
    : status === 'expiring' ? 'bg-amber-500'
    : 'bg-muted-foreground';
  return (
    <Badge variant="outline" className="h-[26px] gap-1.5 text-xs font-medium px-2.5">
      <span className={`size-1.5 rounded-full ${tone}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function RailHeading({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3.5">
      {children}
      {count != null && (
        <span className="font-mono text-[10px] border rounded-full px-1.5 tracking-normal normal-case">{count}</span>
      )}
    </h2>
  );
}

function ControlRow({ icon: Icon, label, children, warn, last }: {
  icon: typeof Clock; label: string; children: React.ReactNode; warn?: boolean; last?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2.5 py-2.5 ${last ? '' : 'border-b'} first:pt-0`}>
      <dt className="flex items-center gap-2 text-muted-foreground shrink-0">
        <Icon className="size-3.5" />{label}
      </dt>
      <dd className={`ml-auto font-medium text-right ${warn ? 'text-amber-600 dark:text-amber-500 font-semibold' : ''}`}>
        {children}
      </dd>
    </div>
  );
}

function BarList({ caption, rows, total, icons }: {
  caption: string; rows: Ranked[]; total: number; icons?: boolean;
}) {
  const ICONS: Record<string, typeof Monitor> = { Desktop: Monitor, Mobile: Smartphone, Tablet: Tablet };
  return (
    <>
      <p className="text-[11px] font-semibold text-muted-foreground mb-2.5">{caption}</p>
      <ul className="flex flex-col gap-2.5 mb-4">
        {rows.map((r) => {
          const pct = total ? Math.round((r.count / total) * 100) : 0;
          const Icon = icons ? ICONS[r.label] : undefined;
          return (
            <li key={r.label} className="grid grid-cols-[1fr_auto] gap-x-2.5 gap-y-1 items-center text-xs">
              <span className="flex items-center gap-2 min-w-0">
                {Icon && <Icon className="size-3.5 text-muted-foreground shrink-0" />}
                <span className="truncate">{r.label}</span>
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">{r.count} · {pct}%</span>
              <span className="col-span-2 h-[7px] rounded-[3px] bg-muted overflow-hidden">
                <i className="block h-full rounded-[3px] bg-[var(--share-opens)]" style={{ width: `${pct}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="px-8 pt-7 pb-14 max-w-[1400px]">
      <Skeleton className="h-4 w-16" />
      <div className="flex items-center gap-3 mt-4">
        <Skeleton className="size-[42px] rounded-xl" />
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-52" />
          <Skeleton className="h-3 w-64" />
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_316px] gap-5 mt-6 items-start">
        <div className="flex flex-col gap-5">
          {/* The headline arrives with the page, not after it - a number that
              pops in once everything else has settled reads as a glitch. */}
          <div className="bg-card border rounded-2xl p-6 space-y-3">
            <Skeleton className="h-8 w-[85%]" />
            <Skeleton className="h-8 w-[55%]" />
            <Skeleton className="h-3 w-full mt-4" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
          <div className="bg-card border rounded-2xl p-6 space-y-4">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-[220px] w-full" />
          </div>
          <div className="bg-card border rounded-2xl p-6 space-y-3">
            <Skeleton className="h-4 w-28" />
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
          </div>
        </div>
        <div className="flex flex-col gap-5">
          <div className="bg-card border rounded-2xl p-[18px] space-y-3">
            <Skeleton className="h-3 w-24" />
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-5 w-full" />)}
          </div>
          <div className="bg-card border rounded-2xl p-[18px] space-y-3">
            <Skeleton className="h-3 w-28" />
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        </div>
      </div>
    </div>
  );
}
