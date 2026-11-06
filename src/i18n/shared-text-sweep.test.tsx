/**
 * Text from the shared packages in Turkish: the strict matcher
 * (translateExternal), the validation policy's messages at their display
 * sites, the e2ee client's errors in the Vault dialogs, and the video player's
 * own labels. English stays byte-identical.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';
import { makeT } from '@/i18n/translator';
import { DEFAULT_LABELS, DEFAULT_REPORT_LABELS } from '@dosya-dev/video-player';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, API_BASE: 'https://api.dosya.dev', api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('@/components/turnstile-widget', () => ({ TurnstileWidget: () => <div data-testid="turnstile" /> }));

const { translateExternal } = await import('@/lib/external-text');
const { videoLabels, reportLabels } = await import('@/components/video/video-labels');
const { EXTERNAL_KEYS } = await import('@/i18n/external-keys');
const { EncryptedBrowser } = await import('@/components/e2ee/encrypted-browser');
const { useE2ee, errorText } = await import('@/stores/e2ee');
const { screenBatch, summariseRejections, checkUploadFile } = await import('@/lib/upload-limits');
const { loadMessages, I18nProvider } = await import('@/lib/i18n');
const SignUpPage = (await import('@/pages/sign-up')).default;
const tr = (await import('@/i18n/messages/tr.json')).default as Record<string, string>;
const en = (await import('@/i18n/messages/en.json')).default as Record<string, string>;
type E2eeEngine = import('@/stores/e2ee').E2eeEngine;

let shown: Rendered | null = null;
vi.setConfig({ testTimeout: 20_000 });
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  shown?.unmount();
  shown = null;
  apiMock.mockReset();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const text = () => document.body.textContent ?? '';

/** Makes `locale` the active language for module-level calls. */
async function activate(locale: 'tr' | 'en') {
  const r = await renderInLocale(createElement('span'), locale);
  r.unmount();
}

describe('translateExternal', () => {
  it('translates a validation message and keeps the captured value untouched', async () => {
    await activate('tr');
    const out = translateExternal('Folder name "a/b" contains invalid characters');
    expect(out).toBe(makeT('tr', tr, en)('common.error.folderNameNameContainsInvalidCharacters', { name: 'a/b' }));
    expect(out).toContain('a/b');
    expect(out).not.toContain('contains invalid');
  });

  it('translates a message with a number and a message with none', async () => {
    await activate('tr');
    expect(translateExternal('Password must be at least 8 characters')).toBe(tr['common.error.passwordMustBeAtLeastMinCharacters'].replace('{min}', '8'));
    expect(translateExternal('Name is required')).toBe(tr['common.error.nameIsRequired']);
  });

  it('leaves text that only contains a catalog sentence unchanged', async () => {
    await activate('tr');
    expect(translateExternal('Name is required for everyone')).toBe('Name is required for everyone');
    expect(translateExternal('Error: Name is required')).toBe('Error: Name is required');
    expect(translateExternal('Cannot reach the server')).toBe('Cannot reach the server');
  });

  it('is the identity in English', async () => {
    await activate('en');
    expect(translateExternal('Name is required')).toBe('Name is required');
    expect(translateExternal('Folder name "a/b" contains invalid characters')).toBe('Folder name "a/b" contains invalid characters');
  });

  it('translates an e2ee client error', async () => {
    await activate('tr');
    expect(translateExternal('e2ee: chunk upload failed (500)')).toBe(tr['vault.error.e2eeChunkUploadFailedResstatus'].replace('{resStatus}', '500'));
    expect(translateExternal('e2ee: workspace fork detected')).toBe(tr['vault.error.e2eeWorkspaceForkDetected']);
  });

  it('accepts the documented hints', async () => {
    await activate('tr');
    for (const hint of ['heading', 'button', 'toast', 'error'] as const) {
      expect(translateExternal('Name is required', hint)).toBe(tr['common.error.nameIsRequired']);
    }
  });
});

describe('EXTERNAL_KEYS', () => {
  const CATALOG = resolve(process.cwd(), '../../packages/i18n/web/en.catalog.json');
  it('exist in the English messages', () => {
    for (const k of EXTERNAL_KEYS) expect(k in en, k).toBe(true);
  });
  it.skipIf(!existsSync(CATALOG))('match the catalog: validation policy and e2ee client uses', () => {
    const cat = JSON.parse(readFileSync(CATALOG, 'utf8')) as { strings: { key: string; uses: string[] }[] };
    const roots = ['../../packages/shared/src/validation', '../../packages/e2ee-client'];
    const expected = cat.strings.filter((s) => s.uses.some((u) => roots.some((r) => u.startsWith(r)))).map((s) => s.key).sort();
    expect([...EXTERNAL_KEYS].sort()).toEqual(expected);
  });
});

describe('validation messages at their display sites', () => {
  it('sign up shows the e-mail and password messages in Turkish', async () => {
    apiMock.mockResolvedValue({ ok: false });
    shown = await renderInLocale(<MemoryRouter initialEntries={['/sign-up']}><SignUpPage /></MemoryRouter>, 'tr');
    await flush();
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const fill = (el: HTMLInputElement, v: string) => { set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const box = shown.container.querySelector<HTMLInputElement>('input[type=checkbox]');
    if (box) await act(async () => { box.click(); });
    const email = shown.container.querySelector<HTMLInputElement>('input[type=email]')!;
    await act(async () => { fill(email, 'not-an-email'); });
    await act(async () => { shown!.container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); });
    expect(text()).toContain(tr['common.error.validEmailIsRequired']);
    expect(text()).not.toContain('Valid email is required');
  });

  it('the upload screen translates its rejection reasons and the summary', async () => {
    await activate('tr');
    const reason = checkUploadFile({ name: 'a.exe', size: 1 }, { blocked_extensions: '.exe' });
    expect(reason).toBe(tr['common.error.fileTypeExtensionIsNotAllowedInThisWorkspace'].replace('{extension}', '.exe'));
    const files = [{ name: 'a.exe', size: 1 }, { name: 'b.exe', size: 1 }, { name: 'c.exe', size: 1 }];
    const screened = screenBatch(files, { blocked_extensions: '.exe' }, (f) => f.name, (f) => f.size);
    expect(screened.rejected[0].reason).toBe(reason);
    const summary = summariseRejections(screened.rejected);
    expect(summary).toContain(reason!);
    expect(summary).not.toContain('files)');
  });

  it('upload screening stays English in English', async () => {
    await activate('en');
    expect(checkUploadFile({ name: 'a.exe', size: 1 }, { blocked_extensions: '.exe' })).toMatch(/^File type \.?exe is not allowed in this workspace$/);
    expect(summariseRejections([{ name: 'a', reason: 'Nope' }, { name: 'b', reason: 'Nope' }])).toBe('Nope (2 files)');
  });

  it('every display site wraps the policy text with translateExternal', () => {
    const sites = [
      'components/share-modal.tsx', 'components/api-keys/create-key-dialog.tsx', 'components/support/report-problem-dialog.tsx',
      'pages/support.tsx', 'pages/comments.tsx', 'pages/reset-password.tsx', 'pages/sign-up.tsx', 'pages/files.tsx', 'lib/upload-limits.ts',
    ];
    for (const f of sites) {
      const src = readFileSync(resolve(process.cwd(), 'src', f), 'utf8');
      expect(src, f).toContain('translateExternal(');
    }
  });
});

describe('e2ee client errors in the Vault dialogs', () => {
  function engine(over: Partial<E2eeEngine>): E2eeEngine {
    return {
      hasIdentity: async () => true, setup: async () => ({ recoveryKeyHex: 'ab' }), unlock: async () => {},
      unlockWithRecoveryKey: async () => {}, destroyIdentity: async () => {}, lock: () => {}, createWorkspace: async () => {},
      readWorkspaceName: async () => null, readWorkspaceNameById: async () => null, renameWorkspace: async () => {},
      setWorkspaceScope: async () => {}, openWorkspace: async () => {}, listFolder: async () => [],
      uploadFile: async () => {}, downloadFile: async () => new Uint8Array(), listMembers: async () => [],
      inviteMember: async () => {}, revokeMember: async () => {}, listMyWorkspaces: async () => [], ...over,
    } as E2eeEngine;
  }
  beforeEach(() => {
    useE2ee.setState({ status: 'locked', error: null, errorKey: null, hasIdentity: null, workspaces: [], activeWorkspaceId: null, entries: [], members: [], busy: false, recoveryKeyOnce: null });
  });

  it('errorText translates library text and leaves English alone', async () => {
    await activate('tr');
    expect(errorText({ error: 'e2ee: workspace fork detected', errorKey: null })).toBe(tr['vault.error.e2eeWorkspaceForkDetected']);
    expect(errorText({ error: 'something unknown', errorKey: null })).toBe('something unknown');
    await activate('en');
    expect(errorText({ error: 'e2ee: workspace fork detected', errorKey: null })).toBe('e2ee: workspace fork detected');
  });

  it('the Vault browser shows a library error in Turkish', async () => {
    apiMock.mockResolvedValue({ ok: true });
    useE2ee.setState({
      status: 'unlocked', activeWorkspaceId: 's1',
      workspaces: [{ id: 's1', name: 'Personal', selfFounded: true, globalWorkspaceId: 'gw1', shared: false }],
    });
    useE2ee.getState().__setEngine(engine({ listFolder: async () => { throw new Error('e2ee: workspace fork detected'); } }));
    shown = await renderInLocale(<MemoryRouter><EncryptedBrowser /></MemoryRouter>, 'tr');
    await flush(); await flush();
    await act(async () => { await useE2ee.getState().refreshFolder(); });
    await flush();
    expect(text()).toContain(tr['vault.error.e2eeWorkspaceForkDetected']);
    expect(text()).not.toContain('e2ee: workspace fork detected');
    // The store still holds the library's own text.
    expect(useE2ee.getState().error).toBe('e2ee: workspace fork detected');
  });
});

describe('video player labels', () => {
  const trT = makeT('tr', tr, en);
  const enT = makeT('en', en, en);

  it('videoLabels and reportLabels cover every label from the catalog in Turkish', () => {
    const l = videoLabels(trT);
    const r = reportLabels(trT);
    expect(l.play).toBe(tr['common.accessibility.play']);
    expect(l.keyboardShortcuts).toBe(tr['common.action.keyboardShortcuts']);
    expect(l.comment('x')).toBe(trT('common.label.commentMlabel', { excerpt: 'x' }));
    expect(r.send).toBe(tr['common.action.sendReport']);
    expect(r.decodeError(3)).toBe(trT('common.label.decodeErrorDmediaError', { dMedia_error: 3 }));
    expect(r.atTime('1:02')).toBe(trT('common.label.atFormattedvalue', { time: '1:02' }));
    expect(r.detailsTooLong(5000)).toBe(trT('common.error.detailsMustBeDetailsMaxCharactersOrFewer', { DETAILS_MAX: '5000' }));
    for (const [k, v] of Object.entries(l)) if (typeof v === 'string') expect(v, k).not.toBe('');
    for (const [k, v] of Object.entries(r)) if (typeof v === 'string') expect(v, k).not.toBe('');
  });

  it('in English videoLabels equals the package defaults', () => {
    const l = videoLabels(enT);
    const { reportPopover, ...rest } = l;
    const { reportPopover: _d, ...defaults } = DEFAULT_LABELS;
    for (const [k, v] of Object.entries(defaults)) {
      if (typeof v === 'function') expect((rest as Record<string, unknown>)[k], k).toBeTypeOf('function');
      else expect((rest as Record<string, unknown>)[k], k).toBe(v);
    }
    expect(l.comment('x')).toBe(DEFAULT_LABELS.comment('x'));
    for (const [k, v] of Object.entries(DEFAULT_REPORT_LABELS)) {
      if (typeof v === 'function') continue;
      expect((reportPopover as unknown as Record<string, unknown>)[k], k).toBe(v);
    }
    expect(reportPopover.atTime('1:02')).toBe('At 1:02');
    expect(reportPopover.decodeError(3)).toBe('Decode error 3');
    expect(reportPopover.browserOnOs('Chrome', 'macOS')).toBe('Chrome on macOS');
    expect(reportPopover.detailsTooLong(5000)).toBe('Details must be 5000 characters or fewer');
    expect(l.reportPopover.validEmailRequired).toBe('Valid email is required');
  });

  describe('the mounted player', () => {
    const mediaProps = ['play', 'pause', 'load', 'canPlayType'] as const;
    let saved: Partial<Record<(typeof mediaProps)[number], PropertyDescriptor | undefined>> = {};
    let host: HTMLElement;
    let root: Root;
    beforeEach(() => {
      saved = {};
      for (const k of mediaProps) saved[k] = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, k);
      Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, writable: true, value: vi.fn(() => Promise.resolve()) });
      Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, writable: true, value: vi.fn() });
      Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, writable: true, value: vi.fn() });
      Object.defineProperty(HTMLMediaElement.prototype, 'canPlayType', { configurable: true, writable: true, value: () => 'maybe' });
      if (typeof window.matchMedia !== 'function') {
        Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) });
      }
      host = document.createElement('div');
      document.body.append(host);
    });
    afterEach(() => {
      act(() => root?.unmount());
      host.remove();
      for (const k of mediaProps) {
        const d = saved[k];
        if (d) Object.defineProperty(HTMLMediaElement.prototype, k, d);
        else delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>)[k];
      }
    });

    it('renders its control labels in Turkish and has no leftover English', async () => {
      const { VideoPlayer } = await import('@/components/video/video-player');
      const { AnchorProvider } = await import('@/components/comments/anchor-context');
      const messages = await loadMessages('tr');
      root = createRoot(host);
      await act(async () => {
        root.render(
          <I18nProvider initial="tr" initialMessages={messages}>
            <AnchorProvider markers={[]} pending={null} onPendingApplied={() => {}} onSelectComment={() => {}}>
              <VideoPlayer file={{ id: 'f1', name: 'clip.mp4' } as never} stableRawUrl="https://api.test/raw" downloadUrl="https://api.test/dl" />
            </AnchorProvider>
          </I18nProvider>,
        );
        await Promise.resolve();
      });
      const q = (s: string) => host.querySelector(s);
      expect(q('.dp-big')!.getAttribute('aria-label')).toBe(tr['common.accessibility.play']);
      expect(q('.dp-stage-status')!.textContent).toBe(tr['common.description.loadingVideo']);
      expect(q('.dp-keys-title')!.textContent).toBe(tr['common.heading.keyboardShortcuts']);
      expect(q('.dp-report-btn .vjs-control-text')!.textContent).toBe(tr['common.action.report']);
      expect(q('.dp-keys-btn .vjs-control-text')!.textContent).toBe(tr['common.action.keyboardShortcuts']);
      expect(q('button.dp-opt[data-reason=playback]')!.textContent).toContain(tr['common.heading.videoWonTPlay']);
      const { leftoverEnglish, collectTexts } = await import('../../tests/helpers/i18n-sweep');
      // Video.js's own text-track settings dialog (captions are not used) is the only English left.
      const VIDEOJS_OWN = new Set(['Beginning of dialog window. Escape will cancel and close the window.', 'Color', 'Green', 'Blue', 'None', 'Reset', 'Done', ', selected']);
      expect(leftoverEnglish(collectTexts(host), 'tr', messages).filter((x) => !VIDEOJS_OWN.has(x))).toEqual([]);
      expect(q('.vjs-play-control .vjs-control-text')!.textContent).toBe(tr['common.accessibility.play']);
    });
  });
});
