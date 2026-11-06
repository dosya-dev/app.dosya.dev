import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The viewer's Edit on a text file: Markdown and .txt go to the full-page
// editor through the host's `onEditText`; other text (JSON, code) and hosts
// without the callback keep the in-viewer TextEditorOverlay.

const apiMock = vi.fn().mockRejectedValue(new Error('network disabled in test'));
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('@/components/comments/api', () => ({
  listComments: vi.fn().mockResolvedValue([]), postComment: vi.fn(), deleteComment: vi.fn(),
  editComment: vi.fn(), searchMentionable: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/components/text-editor', () => ({
  TextEditorOverlay: (props: { file: { name: string } }) => createElement('div', { 'data-testid': 'text-editor', 'data-name': props.file.name }),
}));

const { FileViewer } = await import('./file-viewer');

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
  vi.unstubAllGlobals();
});

function fileNamed(name: string, mime: string, lock = 'none') {
  return {
    id: 'f1', name, size_bytes: 0, mime_type: mime, extension: name.split('.').pop(), region: 'weur',
    created_at: 1, updated_at: 1, current_version: 1, lock_mode: lock, is_hidden: 0, uploaded_by: 'u1',
    uploader_name: 'User', share_count: 0, comment_count: 0, is_synced: 0,
  };
}

async function render(file: ReturnType<typeof fileNamed>, onEditText?: (f: { id: string; name: string }) => void) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0), text: async () => '' }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(FileViewer, {
      file: file as never, files: [file] as never, workspaceId: 'w1',
      onClose: () => {}, onNavigate: () => {}, onRefresh: () => {}, onEditText,
    }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

const overlay = () => document.body.querySelector('[data-testid="text-editor"]');
const editButton = () => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Edit');

async function clickEdit() {
  const button = editButton();
  expect(button, 'Edit button').toBeTruthy();
  await act(async () => { button!.click(); });
}

describe('FileViewer Edit on text files', () => {
  it('sends Markdown to the full-page editor', async () => {
    const onEditText = vi.fn();
    await render(fileNamed('plan.md', 'text/markdown'), onEditText);
    await clickEdit();
    expect(onEditText).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1', name: 'plan.md' }));
    expect(overlay()).toBeNull();
  });

  it('sends .txt to the full-page editor', async () => {
    const onEditText = vi.fn();
    await render(fileNamed('notes.txt', 'text/plain'), onEditText);
    await clickEdit();
    expect(onEditText).toHaveBeenCalledTimes(1);
  });

  it('keeps the in-viewer editor for other text', async () => {
    const onEditText = vi.fn();
    await render(fileNamed('data.json', 'application/json'), onEditText);
    await clickEdit();
    expect(onEditText).not.toHaveBeenCalled();
    expect(overlay()?.getAttribute('data-name')).toBe('data.json');
  });

  it('falls back to the in-viewer editor when the host gives no route', async () => {
    await render(fileNamed('plan.md', 'text/markdown'));
    await clickEdit();
    expect(overlay()?.getAttribute('data-name')).toBe('plan.md');
  });

  it('offers no Edit for a password-locked file', async () => {
    const onEditText = vi.fn();
    await render(fileNamed('plan.md', 'text/markdown', 'full_lock'), onEditText);
    expect(editButton()).toBeUndefined();
  });
});
