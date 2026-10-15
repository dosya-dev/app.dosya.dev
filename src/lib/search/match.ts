import type { Ranked, SearchItem } from './types';

/** Lowercase, Turkish i folded, accents stripped, whitespace collapsed. */
export function normalize(s: string): string {
  return s
    .replace(/[İı]/g, 'i')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (s: string) => s.split(/[^a-z0-9]+/).filter(Boolean);

function wordScore(w: string, title: string, titleWords: string[], keywordWords: string[], extra: string): number {
  if (title.startsWith(w)) return 80;
  if (titleWords.some((t) => t.startsWith(w))) return 60;
  if (keywordWords.some((k) => k.startsWith(w))) return 50;
  if (title.includes(w)) return 30;
  if (extra.includes(w)) return 10;
  return 0;
}

export function scoreItem(query: string, item: SearchItem): number {
  const q = normalize(query);
  if (!q) return 0;
  const title = normalize(item.title);
  const keywords = (item.keywords ?? []).map(normalize);
  if (title === q) return 100;
  if (keywords.includes(q)) return 85;
  if (title.startsWith(q)) return 80;
  const titleWords = words(title);
  const keywordWords = keywords.flatMap(words);
  const extra = normalize(`${item.summary ?? ''} ${item.context ?? ''}`);
  const qWords = words(q);
  if (qWords.length === 0) return 0;
  let total = 0;
  for (const w of qWords) {
    const s = wordScore(w, title, titleWords, keywordWords, extra);
    if (s === 0) return 0;
    total += s;
  }
  return Math.round(total / qWords.length);
}

const TOP_HIT_MIN = 80;

export function rankItems(query: string, items: SearchItem[], limit = 3): Ranked {
  const scored = items
    .map((item, index) => ({ item, index, score: scoreItem(query, item) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.length - b.item.title.length || a.index - b.index);
  const top = scored.find((s) => s.item.kind !== 'help' && s.score >= TOP_HIT_MIN) ?? null;
  const rest = scored.filter((s) => s !== top).map((s) => s.item);
  return {
    topHit: top?.item ?? null,
    goto: rest.filter((i) => i.kind === 'goto').slice(0, limit),
    integration: rest.filter((i) => i.kind === 'integration').slice(0, limit),
    help: rest.filter((i) => i.kind === 'help').slice(0, limit),
  };
}
