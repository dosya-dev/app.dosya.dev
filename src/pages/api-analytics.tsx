import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { api, apiErrorMessage } from '@/api/client';
import { getAnalyticsLogs, getAnalyticsSeries } from '@/api/api-analytics';
import { bucketLabel, type AnalyticsRange, type LogRow, type SeriesResponse } from '@/lib/api-analytics';
import { shortDateTime } from '@/lib/helpers';

interface ApiKeyOption { id: string; name: string }

const RANGE_TABS: { value: AnalyticsRange; label: string }[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

export default function ApiAnalyticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedKey = searchParams.get('key') ?? 'all';
  const [range, setRange] = useState<AnalyticsRange>('24h');
  const [keys, setKeys] = useState<ApiKeyOption[]>([]);
  const [series, setSeries] = useState<SeriesResponse | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  // Bumped on every load() call; in-flight responses check this before applying
  // state so a slow, stale request (from a since-changed key/range, or a
  // loadMore superseded by a fresh load) can't clobber newer results.
  const requestIdRef = useRef(0);

  useEffect(() => {
    api<{ ok: boolean; keys: ApiKeyOption[] }>('/api/me/api-keys')
      .then((res) => setKeys(res.keys ?? []))
      .catch(() => setKeys([]));
  }, []);

  const load = useCallback(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setLoadMoreError(null);
    setLoadingMore(false);
    Promise.all([getAnalyticsSeries(selectedKey, range), getAnalyticsLogs(selectedKey, range)])
      .then(([s, l]) => {
        if (requestIdRef.current !== requestId) return;
        setSeries(s);
        setLogs(l.logs);
        setHasMore(l.has_more);
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return;
        setError(apiErrorMessage(err));
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
  }, [selectedKey, range]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = () => {
    const oldest = logs[logs.length - 1];
    if (!oldest) return;
    const requestId = requestIdRef.current;
    setLoadingMore(true);
    setLoadMoreError(null);
    getAnalyticsLogs(selectedKey, range, oldest.t)
      .then((l) => {
        if (requestIdRef.current !== requestId) return;
        setLogs((prev) => [...prev, ...l.logs]);
        setHasMore(l.has_more);
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return;
        setLoadMoreError(apiErrorMessage(err));
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoadingMore(false);
      });
  };

  const chartData = useMemo(
    () => (series?.series ?? []).map((b) => ({ ...b, label: bucketLabel(b.t, range) })),
    [series, range],
  );
  const totals = series?.totals ?? { total: 0, errors: 0 };
  const errorRate = totals.total > 0 ? ((totals.errors / totals.total) * 100).toFixed(1) : '0.0';
  const showKeyColumn = selectedKey === 'all';

  const keySelectItems = useMemo(
    () => [{ value: 'all', label: 'All keys' }, ...keys.map((k) => ({ value: k.id, label: k.name }))],
    [keys],
  );

  return (
    <div className="p-6 space-y-5 overflow-y-auto animate-in fade-in duration-300">
      {/* Header + filters (one row above the charts) */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">API analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Requests made with your API keys</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={selectedKey}
            onValueChange={(v) => setSearchParams(!v || v === 'all' ? {} : { key: v })}
            items={keySelectItems}
          >
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All keys</SelectItem>
              {keys.map((k) => (
                <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Tabs value={range} onValueChange={(v) => setRange(v as AnalyticsRange)}>
            <TabsList>
              {RANGE_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="text-xs">{t.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      {error ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <ApiAnalyticsSkeleton />
      ) : (
        <div className="space-y-5 animate-content-in">
          {/* space-y-5 is repeated from the page root on purpose: these used to
              be direct children of it, so the fade wrapper would otherwise eat
              the gaps between the tiles, the chart and the table. */}
          {/* Stat tiles */}
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Requests</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tracking-tight">{totals.total.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Errors</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tracking-tight">
                  {totals.errors.toLocaleString()}
                  <span className="text-sm font-normal text-muted-foreground ml-1.5">{errorRate}%</span>
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Chart */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">Requests over time</CardTitle>
              {/* Legend in text tokens; colored dots carry identity */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: 'var(--chart-2)' }} /> Requests
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: 'var(--destructive)' }} /> Errors
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {totals.total === 0 ? (
                <div className="h-[260px] flex flex-col items-center justify-center text-center">
                  <p className="text-sm text-muted-foreground">No requests in this period</p>
                  <p className="text-xs text-muted-foreground mt-1">New requests can take a minute or two to appear.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                      minTickGap={32}
                    />
                    <YAxis
                      width={40}
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border)' }} />
                    <Area
                      type="monotone"
                      dataKey="total"
                      name="Requests"
                      stroke="var(--chart-2)"
                      strokeWidth={2}
                      fill="var(--chart-2)"
                      fillOpacity={0.12}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="errors"
                      name="Errors"
                      stroke="var(--destructive)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Request log */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Recent requests</CardTitle></CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">No requests logged in this period</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Time</TableHead>
                        {showKeyColumn && <TableHead className="text-xs">Key</TableHead>}
                        <TableHead className="text-xs">Action</TableHead>
                        <TableHead className="text-xs">Source</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">IP address</TableHead>
                        <TableHead className="text-xs hidden lg:table-cell">Country</TableHead>
                        <TableHead className="text-xs hidden xl:table-cell">Client</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((row, i) => (
                        <TableRow key={`${row.t}-${i}`}>
                          <TableCell className="text-xs whitespace-nowrap">{shortDateTime(row.t)}</TableCell>
                          {showKeyColumn && (
                            <TableCell className="text-xs truncate max-w-[120px]">{row.api_key_name ?? '-'}</TableCell>
                          )}
                          <TableCell className="text-xs font-mono truncate max-w-[220px]" title={row.action}>
                            {row.action}
                          </TableCell>
                          <TableCell>
                            <Badge variant={row.source === 's3' ? 'secondary' : 'outline'} className="text-[10px]">
                              {row.source === 's3' ? 'S3' : 'REST'}
                            </Badge>
                          </TableCell>
                          <TableCell
                            className={`text-xs font-medium ${row.status >= 400 ? 'text-destructive' : 'text-muted-foreground'}`}
                          >
                            {row.status}
                          </TableCell>
                          <TableCell className="text-xs font-mono">{row.ip}</TableCell>
                          <TableCell className="text-xs hidden lg:table-cell">{row.country || '-'}</TableCell>
                          <TableCell
                            className="text-xs text-muted-foreground hidden xl:table-cell truncate max-w-[200px]"
                            title={row.user_agent}
                          >
                            {row.user_agent || '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {hasMore && (
                    <div className="pt-3 text-center space-y-2">
                      <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                        {loadingMore ? 'Loading…' : 'Load more'}
                      </Button>
                      {loadMoreError && (
                        <p className="text-xs text-destructive">{loadMoreError}</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color?: string; stroke?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-sm text-xs">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: p.stroke ?? p.color }} />
          {p.name}: <span className="font-medium text-foreground">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

function ApiAnalyticsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 max-w-md">
        <Card><CardContent className="pt-6 space-y-2"><Skeleton className="h-4 w-20" /><Skeleton className="h-8 w-24" /></CardContent></Card>
        <Card><CardContent className="pt-6 space-y-2"><Skeleton className="h-4 w-20" /><Skeleton className="h-8 w-24" /></CardContent></Card>
      </div>
      <Card><CardContent className="pt-6"><Skeleton className="h-[260px] w-full" /></CardContent></Card>
      <Card><CardContent className="pt-6 space-y-3">
        <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" />
      </CardContent></Card>
    </div>
  );
}
