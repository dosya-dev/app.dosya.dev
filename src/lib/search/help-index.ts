import { api } from '@/api/client';
import type { SearchItem } from './types';

export const HELP_ORIGIN = 'https://help.dosya.dev';
export const HELP_INDEX_QUERY_KEY = ['help-index'] as const;

interface HelpIndexEntry { slug: string; category: string; title: string; summary: string; keywords?: string[] }

const isEntry = (v: unknown): v is HelpIndexEntry => {
  const o = v as Record<string, unknown> | null;
  return !!o && typeof o.slug === 'string' && typeof o.category === 'string' && typeof o.title === 'string' && typeof o.summary === 'string';
};

export const helpSearchUrl = (q: string) => `${HELP_ORIGIN}/search?q=${encodeURIComponent(q)}`;

/** Published help articles as search items. Throws on failure so react-query can mark it errored. */
export async function fetchHelpIndex(): Promise<SearchItem[]> {
  const res = await api<{ ok?: boolean; articles?: unknown[] }>('/api/help/index');
  const rows = Array.isArray(res?.articles) ? res.articles.filter(isEntry) : [];
  return rows.map((a) => ({
    id: `help:${a.category}/${a.slug}`,
    kind: 'help',
    title: a.title,
    summary: a.summary,
    context: 'help.dosya.dev',
    keywords: Array.isArray(a.keywords) ? a.keywords.filter((k): k is string => typeof k === 'string') : [],
    href: `${HELP_ORIGIN}/${a.category}/${a.slug}`,
    external: true,
  }));
}
