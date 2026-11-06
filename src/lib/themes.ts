import { t } from '@/lib/i18n';
import type { SwatchName } from '@/lib/palette';
import type { MessageKey } from '@/i18n/keys';

export type Mode = 'light' | 'dark' | 'system';

export interface ThemeMeta {
  id: string;
  /** Catalog key of the display name. The name itself is translated when read. */
  labelKey: MessageKey;
  /** The display name in the current language (read at render time, never stored). */
  readonly label: string;
  swatch: { bg: string; primary: string; accent: string };
}

function theme(id: string, labelKey: MessageKey, swatch: ThemeMeta['swatch']): ThemeMeta {
  return { id, labelKey, get label() { return t(labelKey); }, swatch };
}

// MUST stay in sync with the API allow-list in apps/api/src/lib/appearance.ts.
export const THEMES: ThemeMeta[] = [
  theme('default', 'common.label.default', { bg: '#eef7f1', primary: '#2fa563', accent: '#63c98d' }),
  theme('mono', 'common.label.mono', { bg: '#ffffff', primary: '#242424', accent: '#d4d4d4' }),
  theme('claude', 'common.label.claude', { bg: '#f7f3ec', primary: '#b8623f', accent: '#e5c9b3' }),
  theme('amber', 'common.label.amber', { bg: '#fdfbf5', primary: '#e0a020', accent: '#f2d488' }),
  theme('ocean', 'common.label.ocean', { bg: '#f2f7fc', primary: '#2f6fd0', accent: '#9cc0ec' }),
  theme('bubblegum', 'common.label.bubblegum', { bg: '#fdf2f8', primary: '#db4d94', accent: '#f4a9cf' }),
  theme('vercel', 'common.label.vercel', { bg: '#ffffff', primary: '#111111', accent: '#e5e5e5' }),
  theme('neo-brutal', 'common.label.neoBrutalism', { bg: '#f4f4f0', primary: '#ff5a4d', accent: '#3fca6b' }),
];

export const THEME_IDS = THEMES.map((t) => t.id);
export const DEFAULT_THEME = 'default';
export const DEFAULT_MODE: Mode = 'system';

export function isThemeId(v: unknown): v is string {
  return typeof v === 'string' && THEME_IDS.includes(v);
}
export function isMode(v: unknown): v is Mode {
  return v === 'light' || v === 'dark' || v === 'system';
}

const SWATCH_LABEL_KEY: Record<SwatchName, MessageKey> = {
  green: 'common.label.green',
  teal: 'common.label.teal',
  blue: 'common.label.blue',
  violet: 'common.label.violet',
  pink: 'common.label.pink',
  orange: 'common.label.orange',
  graphite: 'common.label.graphite',
};

/** The display name of a data colour in the current language. palette.ts is generated, so its English `label` stays the data. */
export function swatchLabel(name: SwatchName): string {
  return t(SWATCH_LABEL_KEY[name]);
}
