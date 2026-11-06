import { formatDateWith } from '@/lib/format-locale';
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
  const time = formatDateWith(t, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, 'en-US');
  const day = formatDateWith(t, { month: 'short', day: 'numeric' }, 'en-US');
  if (range === '24h') return time;
  if (range === '7d') return `${day} ${time}`;
  return day;
}
