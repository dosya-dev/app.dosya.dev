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
});
