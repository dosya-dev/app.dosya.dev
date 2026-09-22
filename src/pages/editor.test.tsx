import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { default: EditorPage } = await import('./editor');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  apiMock.mockReset();
  document.getElementById('onlyoffice-docsapi')?.remove();
});

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(MemoryRouter, { initialEntries: ['/editor/file_1'] },
        createElement(Routes, null,
          createElement(Route, { path: '/editor/:fileId', element: createElement(EditorPage) }),
        ),
      ),
    );
  });
}

const okConfig = {
  ok: true,
  documentServerUrl: 'https://docs.dosya.dev',
  config: {
    documentType: 'word',
    type: 'desktop',
    document: { fileType: 'docx', key: 'file_1_v1', title: 'report.docx', url: 'https://r2/x', permissions: { edit: true } },
    editorConfig: { mode: 'edit' as const },
    token: 'a.b.c',
  },
};

describe('EditorPage', () => {
  it('shows an error card with retry when the config request fails', async () => {
    apiMock.mockRejectedValue(new Error('nope'));
    mount();
    await act(async () => {});
    expect(container!.textContent).toContain('could not be loaded');
    expect(container!.querySelector('button')?.textContent).toContain('Try again');
  });

  it('injects the DocsAPI script from the configured server on success', async () => {
    apiMock.mockResolvedValue(okConfig);
    mount();
    await act(async () => {});
    const script = document.getElementById('onlyoffice-docsapi') as HTMLScriptElement | null;
    expect(script?.src).toBe('https://docs.dosya.dev/web-apps/apps/api/documents/api.js');
    expect(container!.querySelector('#oo-editor')).toBeTruthy();
    expect(container!.textContent).toContain('report.docx');
  });

  it('shows a read-only badge in view mode', async () => {
    apiMock.mockResolvedValue({
      ...okConfig,
      config: { ...okConfig.config, editorConfig: { mode: 'view' as const } },
    });
    mount();
    await act(async () => {});
    expect(container!.textContent).toContain('Read-only');
  });

  // A dead script tag left behind after a failed load would never fire
  // load/error again (script elements fire those events only once per src),
  // so a retry that just re-attached listeners to it would hang forever -
  // "Try again" is exactly the recovery path the brief requires to work.
  it('recovers after a failed document-server script load when retried', async () => {
    apiMock.mockResolvedValue(okConfig);
    mount();
    await act(async () => {});

    const firstScript = document.getElementById('onlyoffice-docsapi') as HTMLScriptElement | null;
    expect(firstScript).toBeTruthy();

    act(() => {
      firstScript!.dispatchEvent(new Event('error'));
    });
    await act(async () => {});

    expect(container!.textContent).toContain('could not be loaded');
    expect(document.head.contains(firstScript)).toBe(false);
    expect(document.getElementById('onlyoffice-docsapi')).toBeNull();

    act(() => {
      container!.querySelector('button')!.click();
    });
    await act(async () => {});

    const secondScript = document.getElementById('onlyoffice-docsapi') as HTMLScriptElement | null;
    expect(secondScript).toBeTruthy();
    expect(secondScript).not.toBe(firstScript);
  });
});

// F9 (field report): ONLYOFFICE reports failures through the DocEditor
// `events` hooks, not by throwing - a document server that loads its script
// and then refuses the file used to leave a blank frame under "Loading
// editor...". The config now carries onError/onWarning, and onError renders
// the same error card with a way to still get at the document.
describe('EditorPage ONLYOFFICE error surface', () => {
  let captured: { events?: { onError?: (e: unknown) => void; onWarning?: (e: unknown) => void } } | null = null;

  afterEach(() => {
    captured = null;
    delete (window as { DocsAPI?: unknown }).DocsAPI;
  });

  it('passes events.onError/onWarning and onError renders the error card with preview and download links', async () => {
    (window as { DocsAPI?: unknown }).DocsAPI = {
      DocEditor: class { constructor(_id: string, config: unknown) { captured = config as typeof captured; } destroyEditor() {} },
    };
    apiMock.mockResolvedValue(okConfig);
    mount();
    await act(async () => {});

    expect(typeof captured?.events?.onError).toBe('function');
    expect(typeof captured?.events?.onWarning).toBe('function');

    act(() => { captured!.events!.onError!({ data: { errorCode: -4, errorDescription: 'Download failed' } }); });
    await act(async () => {});

    expect(container!.textContent).toContain('could not be loaded');
    const links = [...container!.querySelectorAll('a')];
    const preview = links.find((a) => a.textContent?.includes('Open preview'));
    expect(preview?.getAttribute('href')).toBe('/files?view=file_1');
    const download = links.find((a) => a.textContent?.includes('Download'));
    expect(download?.getAttribute('href')).toMatch(/\/api\/files\/file_1\/download$/);
    // A fatal error DOES take the surface: there is nothing behind it to use.
    expect(container!.querySelector('[data-testid="editor-error-overlay"]')).not.toBeNull();
  });

  // Fix round 1, MINOR (g): the error card is `absolute inset-0`, so it
  // swallows every click meant for the editor underneath. A recoverable
  // onError (an unrecognised code) must not make a working editor unusable.
  it('shows a non-fatal error as a dismissible notice that leaves the editor usable', async () => {
    (window as { DocsAPI?: unknown }).DocsAPI = {
      DocEditor: class { constructor(_id: string, config: unknown) { captured = config as typeof captured; } destroyEditor() {} },
    };
    apiMock.mockResolvedValue(okConfig);
    mount();
    await act(async () => {});

    act(() => { captured!.events!.onError!({ data: { errorCode: -777, errorDescription: 'something odd' } }); });
    await act(async () => {});

    expect(container!.querySelector('[data-testid="editor-error-overlay"]')).toBeNull();
    const notice = container!.querySelector('[data-testid="editor-error-notice"]');
    expect(notice).not.toBeNull();
    // The editor IS loaded and on screen behind it, so the notice must not
    // borrow the fatal card's sentence.
    expect(notice!.textContent).not.toContain('could not be loaded');
    expect(notice!.textContent).toContain('reported a problem');
    expect(container!.querySelector('#oo-editor')).toBeTruthy();

    const dismiss = [...container!.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Dismiss');
    expect(dismiss).toBeTruthy();
    act(() => { dismiss!.click(); });
    expect(container!.querySelector('[data-testid="editor-error-notice"]')).toBeNull();
  });

  // Fix round 2, MINOR 3: an unknown code may in fact be fatal, leaving a
  // dismissible notice floating over a blank editor. The notice carries the
  // same escapes the fatal card does, so an unrecognised failure is never a
  // dead end.
  it('offers Try again, preview and download from the non-fatal notice', async () => {
    (window as { DocsAPI?: unknown }).DocsAPI = {
      DocEditor: class { constructor(_id: string, config: unknown) { captured = config as typeof captured; } destroyEditor() {} },
    };
    apiMock.mockResolvedValue(okConfig);
    mount();
    await act(async () => {});
    expect(apiMock).toHaveBeenCalledTimes(1);

    act(() => { captured!.events!.onError!({ data: { errorCode: -777 } }); });
    await act(async () => {});

    const notice = container!.querySelector('[data-testid="editor-error-notice"]')!;
    const links = [...notice.querySelectorAll('a')];
    expect(links.find((a) => a.textContent?.includes('Open preview'))?.getAttribute('href')).toBe('/files?view=file_1');
    expect(links.find((a) => a.textContent?.includes('Download'))?.getAttribute('href')).toMatch(/\/api\/files\/file_1\/download$/);

    const tryAgain = [...notice.querySelectorAll('button')].find((b) => b.textContent?.includes('Try again'));
    expect(tryAgain).toBeTruthy();
    await act(async () => { tryAgain!.click(); });
    // A real reload of the editor, not just a hidden notice.
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(container!.querySelector('[data-testid="editor-error-notice"]')).toBeNull();
  });

  it('never turns a warning into an error card', async () => {
    (window as { DocsAPI?: unknown }).DocsAPI = {
      DocEditor: class { constructor(_id: string, config: unknown) { captured = config as typeof captured; } destroyEditor() {} },
    };
    apiMock.mockResolvedValue(okConfig);
    mount();
    await act(async () => {});

    act(() => { captured!.events!.onWarning!({ data: { warningCode: 1, warningDescription: 'co-editing' } }); });
    await act(async () => {});

    expect(container!.textContent).not.toContain('could not be loaded');
    expect(container!.querySelector('[data-testid="editor-error-overlay"]')).toBeNull();
    expect(container!.querySelector('[data-testid="editor-error-notice"]')).toBeNull();
  });
});
