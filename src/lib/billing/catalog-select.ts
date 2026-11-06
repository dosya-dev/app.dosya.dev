import { useEffect, useState } from 'react';
import { t, useLocale, loadMessages } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';
import type { Locale } from '@/i18n/locales';
import { parseIcu, renderIcu, type IcuNode } from '@/i18n/icu';
import en from '@/i18n/messages/en.json';

const english = en as Record<string, string>;

type Values = Record<string, string | number>;

/** Swaps every string value for a private token, so data never meets the text surgery below. */
function guard(values: Values): { guarded: Values; restore: (s: string) => string } {
  const tokens: string[] = [];
  const guarded: Values = {};
  for (const [name, v] of Object.entries(values)) {
    if (typeof v === 'string') {
      guarded[name] = `\uE000${tokens.length}\uE000`;
      tokens.push(v);
    } else guarded[name] = v;
  }
  return { guarded, restore: (s) => s.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => tokens[Number(i)]) };
}

/** Collapses repeated spaces and drops the space a catalog text leaves before . , ; */
export function tidyText(s: string): string {
  return s.replace(/ {2,}/g, ' ').replace(/ ([.,;])/g, '$1');
}

/**
 * TODO(catalog): a few billing messages are written as
 * `{x, select, true {... {x} ...} other {}}`: the select needs the value "true"
 * to pick its branch, but the inner `{x}` prints that same value, so the text
 * it is meant to carry (a date, an error) can never reach it. This renders the
 * message with the "true" branch (or the "other" one when `carried` is null),
 * finds where the value was printed and puts the real text there. Other string
 * values go through private tokens first, so data that happens to contain the
 * word "true" is never touched. `tidy` collapses the doubled spaces and the
 * space before a full stop that the catalog text leaves around an empty branch.
 */
export function selectCarrying(
  key: MessageKey,
  values: Values,
  selectName: string,
  carried: string | null,
  opts: { tidy?: boolean } = {},
): string {
  const { guarded, restore } = guard(values);
  guarded[selectName] = carried === null ? 'false' : 'true';
  let out = t(key, guarded);
  if (carried !== null) out = out.split('true').join('\uE001');
  if (opts.tidy) out = tidyText(out);
  return restore(out.split('\uE001').join(carried ?? ''));
}

/**
 * TODO(catalog): "Code {couponCode} applied {d, select, true { - discounts your
 * first payment only} other {}} {d, select, true { - applies for {m} months}
 * other {}}." puts two exclusive sentences behind one select name, and the
 * months slot cannot carry a number. The message is parsed and its two selects
 * are rendered separately, so every language works whatever it puts between
 * the sentences: "once" keeps the first, "repeating" the second, anything else
 * neither. `raw` is the message text of the current language (see useRawMessage).
 */
export function couponAppliedText(raw: string, locale: Locale, code: string, kind: 'once' | 'repeating' | 'none', months: number): string {
  const nodes = parseIcu(raw);
  const at = nodes.flatMap((n, i) => (typeof n !== 'string' && n.type === 'select' && n.name === 'stateCouponDuration' ? [i] : []));
  const rules = new Intl.PluralRules(locale);
  const nf = new Intl.NumberFormat(locale === 'en' ? undefined : locale);
  const TOKEN = '\uE003';
  const render = (list: IcuNode[]) => renderIcu(list, { couponCode: TOKEN, couponDuration_in_months: String(months) }, rules, nf);
  const finish = (s: string) => tidyText(s).split(TOKEN).join(code);
  if (at.length !== 2) return finish(render(nodes.map((n) => (typeof n !== 'string' && n.type === 'select' ? { ...n, options: { other: n.options.other ?? [] } } : n))));
  const [i1, i2] = at;
  const branch = (n: IcuNode): IcuNode[] => (typeof n !== 'string' && 'options' in n ? n.options.true ?? [] : []);
  return finish(
    render(nodes.slice(0, i1))
      + (kind === 'once' ? render(branch(nodes[i1])) : '')
      + render(nodes.slice(i1 + 1, i2))
      + (kind === 'repeating' ? render(branch(nodes[i2])) : '')
      + render(nodes.slice(i2 + 1)),
  );
}

/** The message text of `key` in the current language, once its file is in (English at once). */
export function useRawMessage(key: MessageKey): string | undefined {
  const { locale } = useLocale();
  const [loaded, setLoaded] = useState<{ locale: Locale; text: string } | null>(null);
  useEffect(() => {
    if (locale === 'en') return;
    let cancelled = false;
    void loadMessages(locale).then((m) => { if (!cancelled) setLoaded({ locale, text: m[key] ?? english[key] }); });
    return () => { cancelled = true; };
  }, [locale, key]);
  if (locale === 'en') return english[key];
  return loaded?.locale === locale ? loaded.text : undefined;
}
