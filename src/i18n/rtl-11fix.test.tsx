/**
 * Truncating names take their direction from the name itself. Browsers skip
 * <bdi> content when resolving dir="auto", so the element that truncates must
 * hold the name directly: a Hebrew name then resolves rtl (aligned to the
 * start, clipped at its end) and a Latin name ltr, in any page direction.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { default: FilesPage } = await import('@/pages/files');
const { useWorkspace } = await import('@/stores/workspace');

let shown: Rendered | null = null;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useWorkspace.setState({ activeId: 'ws_1' });
});
afterEach(() => {
  shown?.unmount();
  shown = null;
  apiMock.mockReset();
  localStorage.clear();
});

/**
 * The HTML auto-directionality of `el` (WHATWG "auto directionality"): the
 * first strong character in its text, skipping bdi, script, style, textarea
 * and any descendant with its own dir attribute; null when there is none
 * (the element then falls back to ltr).
 */
const STRONG_RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const STRONG_LTR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;
function autoDir(el: Element): 'ltr' | 'rtl' | null {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      for (const ch of node.textContent ?? '') {
        if (STRONG_RTL.test(ch)) return 'rtl';
        if (STRONG_LTR.test(ch)) return 'ltr';
      }
    } else if (node instanceof Element) {
      if (['BDI', 'SCRIPT', 'STYLE', 'TEXTAREA'].includes(node.tagName) || node.hasAttribute('dir')) continue;
      const inner = autoDir(node);
      if (inner) return inner;
    }
  }
  return null;
}
/** The direction the browser gives a dir="auto" element. */
const resolved = (el: Element): 'ltr' | 'rtl' => autoDir(el) ?? 'ltr';

const HEBREW = 'גיבוי ישן.zip';
const LATIN = 'report (1).pdf';
const file = (id: string, name: string) => ({
  id, name, size_bytes: 1, mime_type: 'application/zip', extension: name.split('.').pop(), region: 'us',
  created_at: 1_700_000_000, updated_at: 1_700_000_100, current_version: 1, lock_mode: 'none', is_hidden: 0,
  hidden_mode: 'none', uploaded_by: 'u1', uploader_name: 'A', share_count: 0, comment_count: 0, is_synced: 0,
  origin: null, captured_at: null,
});
const filesApi = () => (path: unknown) => Promise.resolve(typeof path === 'string' && path.startsWith('/api/cloud/imports') ? { ok: true, jobs: [] } : {
  ok: true, folders: [{ id: 'd1', name: 'תיקייה', file_count: 0, created_at: 1_700_000_000, updated_at: 1_700_000_000 }], breadcrumbs: [],
  files: [file('f1', HEBREW), file('f2', LATIN)],
  pagination: { page: 1, per_page: 100, total_files: 2, total_pages: 1 },
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); await Promise.resolve(); });
async function showFiles(view: 'list' | 'grid', locale: 'en' | 'ar' | 'he') {
  localStorage.setItem('dosya_files_view', view);
  apiMock.mockImplementation(filesApi());
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  shown = await renderInLocale(<QueryClientProvider client={queryClient}><MemoryRouter><FilesPage /></MemoryRouter></QueryClientProvider>, locale);
  await flush();
  await flush();
  return shown;
}

/** The truncating element whose whole text is `name`. */
const truncatingName = (root: ParentNode, name: string) =>
  [...root.querySelectorAll('.truncate')].filter((el) => el.textContent === name);

describe('truncating names resolve their own direction', () => {
  for (const view of ['list', 'grid'] as const) {
    it(`${view} view in ar: a Hebrew name resolves rtl, a Latin name ltr`, async () => {
      const r = await showFiles(view, 'ar');
      const he = truncatingName(r.container, HEBREW);
      const la = truncatingName(r.container, LATIN);
      expect(he.length, 'hebrew name rendered').toBeGreaterThan(0);
      expect(la.length, 'latin name rendered').toBeGreaterThan(0);
      for (const el of he) {
        expect(el.getAttribute('dir')).toBe('auto');
        expect(resolved(el)).toBe('rtl');
      }
      for (const el of la) {
        expect(el.getAttribute('dir')).toBe('auto');
        expect(resolved(el)).toBe('ltr');
      }
    });
  }

  it('in en a Latin name resolves ltr and its element holds the text directly', async () => {
    const r = await showFiles('list', 'en');
    const la = truncatingName(r.container, LATIN);
    expect(la.length).toBeGreaterThan(0);
    for (const el of la) {
      expect(resolved(el)).toBe('ltr');
      expect(el.querySelector('bdi')).toBeNull();
    }
  });
});

describe('source', () => {
  it('no dir="auto" element wraps its whole text in a <bdi> (browsers skip bdi when resolving auto)', () => {
    const SRC = join(__dirname, '..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.tsx') && !p.includes('.test.')) {
          const src = readFileSync(p, 'utf8');
          // An opening tag carrying dir="auto" whose first child is a <bdi>.
          // (`=>` inside an attribute, as in onClick, is not the tag's end.)
          const re = /<[a-zA-Z]+\b(?:[^<>]|=>)*\bdir="auto"(?:[^<>]|=>)*>\s*<bdi\b/g;
          for (const m of src.matchAll(re)) hits.push(`${p.slice(SRC.length + 1)}:${src.slice(0, m.index).split('\n').length}`);
        }
      }
    };
    walk(SRC);
    expect(hits).toEqual([]);
  });
});
