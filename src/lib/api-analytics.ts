export type AnalyticsRange = '24h' | '7d' | '30d';

export interface SeriesBucket { t: number; total: number; errors: number }

export interface SeriesResponse {
  ok: true;
  range: AnalyticsRange;
  bucket_seconds: number;
  series: SeriesBucket[];
  totals: { total: number; errors: number };
}

export interface LogRow {
  t: number;
  action: string;
  source: string;
  status: number;
  ip: string;
  country: string;
  user_agent: string;
  api_key_id: string;
  api_key_name: string | null;
}

export interface LogsResponse { ok: true; logs: LogRow[]; has_more: boolean }

/** X-axis label for a bucket timestamp (unix seconds), in the viewer's local time. */
export function bucketLabel(t: number, range: AnalyticsRange): string {
  const d = new Date(t * 1000);
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (range === '24h') return time;
  if (range === '7d') return `${day} ${time}`;
  return day;
}
