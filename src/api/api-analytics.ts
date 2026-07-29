import { api } from '@/api/client';
import type { AnalyticsRange, LogsResponse, SeriesResponse } from '@/lib/api-analytics';

export const getAnalyticsSeries = (key: string, range: AnalyticsRange) =>
  api<SeriesResponse>(`/api/me/api-analytics/series?key=${encodeURIComponent(key)}&range=${range}`);

export const getAnalyticsLogs = (key: string, range: AnalyticsRange, before?: number) =>
  api<LogsResponse>(
    `/api/me/api-analytics/logs?key=${encodeURIComponent(key)}&range=${range}${before ? `&before=${before}` : ''}`,
  );
