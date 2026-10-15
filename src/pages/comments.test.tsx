import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const comment = {
  id: 'c1', file_id: 'f1', folder_id: null, workspace_id: 'ws_1', user_id: 'u2', parent_id: null,
  body: 'see @Ada Lovelace here', is_edited: 0, created_at: 1_700_000_000, updated_at: 1_700_000_000,
  user_name: 'Bob', user_email: 'b@x.dev', user_avatar: null,
  anchor_ms: 42_000, anchor_page: null, anchor_version: 1,
  mention_user_ids: '["u3"]', mentions: [{ id: 'u3', name: 'Ada Lovelace' }],
};
vi.mock('@/components/comments/api', () => ({
  listComments: vi.fn(async () => [comment]),
  postComment: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
  searchMentionable: vi.fn(async () => []),
}));

const { default: CommentsPage } = await import('./comments');
const { useWorkspace } = await import('@/stores/workspace');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useWorkspace.setState({ activeId: 'ws_1' });
});

describe('CommentsPage', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null; container = null;
    apiMock.mockReset();
  });

  it('renders mentions, an anchor chip into the viewer, and highlights ?comment', async () => {
    apiMock.mockImplementation((path: string) => Promise.resolve(
      path.startsWith('/api/me')
        ? { user: { id: 'u1', name: 'Me', email: 'm@x.dev', avatar_url: null } }
        : path.startsWith('/api/files')
          ? { ok: true, files: [] }
          : { ok: true },
    ));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={['/comments?file_id=f1&comment=c1']}><CommentsPage /></MemoryRouter>,
      );
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.querySelector('[data-mention]')?.textContent).toBe('@Ada Lovelace');
    expect(container.querySelector('a[href="/files?view=f1&tab=comments&comment=c1&t=42000"]')).not.toBeNull();
    expect(container.querySelector('#comment-c1')?.className).toContain('ring-2');
  });

  it('Reply focuses the composer', async () => {
    apiMock.mockImplementation((path: string) => Promise.resolve(
      path.startsWith('/api/me')
        ? { user: { id: 'u1', name: 'Me', email: 'm@x.dev', avatar_url: null } }
        : path.startsWith('/api/files')
          ? { ok: true, files: [] }
          : { ok: true },
    ));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<MemoryRouter initialEntries={['/comments?file_id=f1']}><CommentsPage /></MemoryRouter>);
      await new Promise((r) => setTimeout(r, 0));
    });
    const ta = container.querySelector('textarea')!;
    expect(document.activeElement).not.toBe(ta);
    await act(async () => { (container!.querySelector('button[title="Reply"]') as HTMLButtonElement).click(); });
    expect(document.activeElement).toBe(ta);
  });
});
