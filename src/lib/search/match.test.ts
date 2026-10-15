import { describe, it, expect } from 'vitest';
import { normalize, scoreItem, rankItems } from './match';
import type { SearchItem } from './types';

const item = (over: Partial<SearchItem>): SearchItem => ({ id: over.title ?? 'x', kind: 'goto', title: 'x', href: '/x', ...over });

describe('normalize', () => {
  it('lowercases, strips accents and folds Turkish dotted and dotless i', () => {
    expect(normalize('  İndir  Şifre ')).toBe('indir sifre');
    expect(normalize('ılık')).toBe('ilik');
    expect(normalize('Café')).toBe('cafe');
  });
});

describe('scoreItem', () => {
  const billing = item({ title: 'Billing', keywords: ['invoice', 'plan'] });
  it('ranks exact, prefix, keyword-equal, word-prefix, keyword-prefix, substring, summary', () => {
    expect(scoreItem('billing', billing)).toBe(100);
    expect(scoreItem('bill', billing)).toBe(80);
    expect(scoreItem('invoice', billing)).toBe(85);
    expect(scoreItem('keys', item({ title: 'API keys' }))).toBe(60);
    expect(scoreItem('invo', billing)).toBe(50);
    expect(scoreItem('llin', billing)).toBe(30);
    expect(scoreItem('drag', item({ kind: 'help', title: 'Upload', summary: 'drag and drop' }))).toBe(10);
    expect(scoreItem('zzz', billing)).toBe(0);
  });
  it('requires every word of a multi-word query and averages them', () => {
    const pw = item({ title: 'Password & 2FA', keywords: ['two-factor', 'authenticator'] });
    expect(scoreItem('two factor', pw)).toBe(50);
    expect(scoreItem('two zebra', pw)).toBe(0);
  });
  it('matches Turkish input against plain titles', () => {
    expect(scoreItem('İndir', item({ title: 'indirme' }))).toBe(80);
  });
  it('scores an empty query as 0', () => {
    expect(scoreItem('   ', billing)).toBe(0);
  });
});

describe('rankItems', () => {
  const items: SearchItem[] = [
    item({ id: 'goto:api', title: 'API keys', keywords: ['token'] }),
    item({ id: 'integration:wordpress', kind: 'integration', title: 'WordPress', keywords: ['wp'] }),
    item({ id: 'help:wp', kind: 'help', title: 'WordPress backups', href: 'https://help.dosya.dev/x/y', external: true }),
    item({ id: 'goto:billing', title: 'Billing' }),
  ];
  it('lifts a strong goto/integration match to topHit and removes it from its group', () => {
    const r = rankItems('wordpress', items);
    expect(r.topHit?.id).toBe('integration:wordpress');
    expect(r.integration).toEqual([]);
    expect(r.help.map((i) => i.id)).toEqual(['help:wp']);
  });
  it('never makes a help article the top hit', () => {
    const r = rankItems('wordpress backups', items);
    expect(r.topHit).toBeNull();
    expect(r.help[0].id).toBe('help:wp');
  });
  it('leaves topHit empty below the threshold', () => {
    expect(rankItems('keys', items).topHit).toBeNull();
    expect(rankItems('keys', items).goto.map((i) => i.id)).toEqual(['goto:api']);
  });
  it('caps each group and breaks ties by shorter title then input order', () => {
    const many = ['Alpha one', 'Alpha', 'Alpha two', 'Alpha three'].map((t, i) => item({ id: `g${i}`, title: t }));
    const r = rankItems('al', many, 3);
    expect(r.topHit?.id).toBe('g1');
    expect(r.goto.map((i) => i.id)).toEqual(['g0', 'g2', 'g3']);
  });
  it('returns nothing for an empty query', () => {
    expect(rankItems('', items)).toEqual({ topHit: null, goto: [], integration: [], help: [] });
  });
});
