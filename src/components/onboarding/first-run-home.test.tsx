import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const enqueue = vi.fn();
const enqueueByFolder = vi.fn<(groups: Map<string | null, File[]>, input: unknown) => number>();
const api = vi.fn<(path: string, init: RequestInit) => Promise<unknown>>();
vi.mock('@/lib/upload-runner', () => ({
  enqueue: (...a: unknown[]) => enqueue(...a),
  enqueueByFolder: (groups: Map<string | null, File[]>, input: unknown) => enqueueByFolder(groups, input),
}));
vi.mock('@/api/client', async (importOriginal) => ({
  // shouldRetryQuery does `error instanceof ApiError` on every retry, and a retry
  // can outlive the test that started it - a mock without it throws and fails the run.
  ApiError: (await importOriginal<typeof import('@/api/client')>()).ApiError,
  api: (path: string, init: RequestInit) => api(path, init),
  apiErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

import { FirstRunHome } from './first-run-home';
import { useOnboarding } from '@/stores/onboarding';
import { useWorkspace } from '@/stores/workspace';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const NONE = {
  upload: false, share: false, import: false, api_key: false, client_used: false,
  invite: false, file_request: false, geo: false, desktop: false, mobile: false,
};

describe('FirstRunHome', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    enqueue.mockClear();
    enqueueByFolder.mockReset();
    enqueueByFolder.mockImplementation((groups) => [...groups.values()].flat().length);
    api.mockReset();
    api.mockImplementation(async () => ({ ok: true, folder: { id: 'fld_new' } }));
    useWorkspace.setState({ activeId: 'ws_1' });
    useOnboarding.setState({ purpose: null, dismissed: false, steps: NONE, loaded: true, failed: false });
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function render() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root!.render(<MemoryRouter><FirstRunHome userName="Jane Doe" /></MemoryRouter>); });
  }

  it('greets the user by first name', () => {
    render();
    expect(container!.textContent).toContain('Jane');
    expect(container!.textContent).not.toContain('Jane Doe');
  });

  it('shows the purpose picker while the purpose is unanswered', () => {
    render();
    expect(container!.querySelector('[data-testid="purpose-dev"]')).not.toBeNull();
  });

  it('replaces the picker with the checklist once a purpose is set', () => {
    useOnboarding.setState({ purpose: 'dev' });
    render();
    expect(container!.querySelector('[data-testid="purpose-dev"]')).toBeNull();
    expect(container!.querySelector('[data-testid="step-api_key"]')).not.toBeNull();
  });

  const drop = async (dataTransfer: unknown) => {
    const zone = container!.querySelector('[data-testid="first-run-dropzone"]')!;
    await act(async () => {
      const ev = new Event('drop', { bubbles: true }) as Event & { dataTransfer?: unknown };
      Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer });
      zone.dispatchEvent(ev);
      // The walk is async even for loose files; let it settle before asserting.
      await Promise.resolve();
    });
  };

  it('sends dropped files to the shared upload runner', async () => {
    render();
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    await drop({ files: [file], items: [] });
    expect(enqueue).toHaveBeenCalledWith([file], { workspace_id: 'ws_1', folder_id: null });
  });

  // A first upload is as likely to be a folder as a file, and dropping one used
  // to queue an unreadable phantom that failed as "Network error".
  it('expands a dropped folder and uploads its contents into a new folder', async () => {
    render();
    const inner = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    const entry = {
      isFile: false, isDirectory: true, name: 'Photos',
      createReader: () => {
        let done = false;
        return {
          readEntries: (ok: (e: unknown[]) => void) => {
            const batch = done ? [] : [{
              isFile: true, isDirectory: false, name: 'a.jpg',
              file: (cb: (f: File) => void) => cb(inner),
            }];
            done = true;
            ok(batch);
          },
        };
      },
    };
    await drop({ files: [], items: [{ kind: 'file', webkitGetAsEntry: () => entry }] });

    expect(api).toHaveBeenCalledWith('/api/folders', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(api.mock.calls[0][1].body as string))
      .toEqual({ workspace_id: 'ws_1', parent_id: null, name: 'Photos' });
    expect(enqueueByFolder.mock.calls[0][0].get('fld_new')).toEqual([inner]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  // Onboarding must never be load-bearing: a failed fetch leaves steps null,
  // and the screen still has to offer the thing that matters most.
  it('still renders the dropzone when onboarding state failed to load', () => {
    useOnboarding.setState({ steps: null, failed: true });
    render();
    expect(container!.querySelector('[data-testid="first-run-dropzone"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="step-upload"]')).toBeNull();
  });
});
