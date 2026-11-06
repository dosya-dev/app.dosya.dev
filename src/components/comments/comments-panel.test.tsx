import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const m = vi.hoisted(() => ({
  listComments: vi.fn(), postComment: vi.fn(), deleteComment: vi.fn(), editComment: vi.fn(), searchMentionable: vi.fn(),
  info: vi.fn(), error: vi.fn(), success: vi.fn(),
}));
vi.mock('./api', () => ({
  listComments: m.listComments, postComment: m.postComment, deleteComment: m.deleteComment,
  editComment: m.editComment, searchMentionable: m.searchMentionable,
}));
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: vi.fn().mockResolvedValue({ user: { id: 'u_me' } }) };
});
vi.mock('@/lib/toast', () => ({ toast: { info: m.info, error: m.error, success: m.success } }));

const { CommentsPanel } = await import('./comments-panel');
const { AnchorProvider, useRegisterAnchorTarget } = await import('./anchor-context');
import type { Comment } from './types';
import type { AnchorTarget } from './anchor-context';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null; let el: HTMLDivElement | null = null;
beforeEach(() => { Object.values(m).forEach((f) => f.mockReset()); });
afterEach(() => { if (root) act(() => root!.unmount()); el?.remove(); root = null; });

const c = (over: Partial<Comment>): Comment => ({
  id: 'c1', file_id: 'f', folder_id: null, workspace_id: 'ws', user_id: 'u_me', parent_id: null,
  body: 'at the drop', is_edited: 0, created_at: 1, updated_at: 1, user_name: 'Me', user_email: 'me@x',
  user_avatar: null, anchor_ms: 42_000, anchor_page: null, anchor_version: 3, mention_user_ids: null, mentions: [],
  ...over,
});

function Player({ target }: { target: AnchorTarget }) { useRegisterAnchorTarget(target); return null; }

async function setup(
  comments: Comment[], target: AnchorTarget | null = null,
  props: { currentVersion?: number; viewingVersion?: number; activeCommentId?: string | null } = {},
  onSelectComment: (id: string) => void = () => {},
) {
  const thread = { comments, loading: false, error: false, reload: vi.fn(async () => {}), setComments: vi.fn() };
  const tree = (list: Comment[]) => createElement(AnchorProvider, {
    markers: [], pending: null, onPendingApplied: () => {}, onSelectComment,
    children: [
      target && createElement(Player, { key: 'p', target }),
      createElement(CommentsPanel, {
        key: 'panel', fileId: 'f', workspaceId: 'ws', currentVersion: props.currentVersion ?? 3,
        viewingVersion: props.viewingVersion ?? 3, thread: { ...thread, comments: list },
        activeCommentId: props.activeCommentId ?? null,
      }),
    ],
  });
  el = document.createElement('div'); document.body.append(el); root = createRoot(el);
  await act(async () => {
    root!.render(tree(comments));
    await Promise.resolve();
  });
  /** The same panel with a new comment list, as when the thread finishes loading. */
  const rerender = async (list: Comment[]) => { await act(async () => { root!.render(tree(list)); await Promise.resolve(); }); };
  return { thread, rerender };
}
const timeTarget = () => ({ kind: 'time' as const, now: () => 42_000, seek: vi.fn(), pause: vi.fn() });

describe('CommentsPanel', () => {
  it('renders threads with an anchor chip', async () => {
    await setup([c({})]);
    expect(el!.textContent).toContain('0:42');
    expect(el!.textContent).toContain('at the drop');
  });

  it('clicking a chip seeks the registered player', async () => {
    const t = timeTarget();
    await setup([c({})], t);
    const chip = [...el!.querySelectorAll('button')].find((b) => b.textContent?.includes('0:42'))!;
    act(() => chip.click());
    expect(t.seek).toHaveBeenCalledWith(42_000);
  });

  it('focusing the composer pauses and captures the time', async () => {
    const t = timeTarget();
    await setup([], t);
    const ta = el!.querySelector('textarea')!;
    act(() => { ta.focus(); });
    expect(t.pause).toHaveBeenCalled();
    expect(el!.textContent).toContain('At 0:42');
  });

  it('posting sends the anchor and the viewing version', async () => {
    const t = timeTarget();
    m.postComment.mockResolvedValue(c({ id: 'c2' }));
    await setup([], t);
    const ta = el!.querySelector('textarea')!;
    act(() => { ta.focus(); });
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => { set.call(ta, 'nice'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await act(async () => { await Promise.resolve(); });
    expect(m.postComment).toHaveBeenCalledWith(expect.objectContaining({ anchor: { kind: 'time', ms: 42_000 }, anchorVersion: 3 }));
  });

  it('an older-version comment shows a v2 badge and its chip selects it', async () => {
    // The "left on v2" toast is the viewer's onSelectComment's job (one place
    // for the chip and every marker; see file-viewer.test.tsx). The panel
    // only selects, so it must not toast a second time itself.
    const t = timeTarget();
    const onSelect = vi.fn();
    await setup([c({ anchor_version: 2 })], t, {}, onSelect);
    expect(el!.textContent).toContain('v2');
    const chip = [...el!.querySelectorAll('button')].find((b) => b.textContent?.includes('0:42'))!;
    act(() => chip.click());
    expect(onSelect).toHaveBeenCalledWith('c1');
    expect(m.info).not.toHaveBeenCalled();
  });

  it('offers delete only on own comments', async () => {
    await setup([c({ id: 'a', user_id: 'u_me' })]);
    expect(el!.querySelector('[aria-label="Delete comment"]')).not.toBeNull();
    act(() => root!.unmount()); el!.remove(); root = null;
    await setup([c({ id: 'b', user_id: 'u_other' })]);
    expect(el!.querySelector('[aria-label="Delete comment"]')).toBeNull();
  });

  it('scrolls to a deep-linked comment once its row loads, and only once', async () => {
    const scroll = vi.fn();
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      const { rerender } = await setup([], null, { activeCommentId: 'c1' });
      expect(scroll).not.toHaveBeenCalled();
      await rerender([c({})]);
      expect(scroll).toHaveBeenCalledTimes(1);
      await rerender([c({}), c({ id: 'c2' })]); // a later post does not yank the view back
      expect(scroll).toHaveBeenCalledTimes(1);
    } finally {
      Element.prototype.scrollIntoView = orig;
    }
  });

  it('a removed anchor chip stays removed on refocus until the comment is posted', async () => {
    const t = timeTarget();
    m.postComment.mockResolvedValue(c({ id: 'c9', anchor_ms: null }));
    await setup([], t);
    const ta = el!.querySelector('textarea')!;
    act(() => { ta.focus(); });
    expect(el!.textContent).toContain('At 0:42');
    act(() => (el!.querySelector('[aria-label="Remove anchor"]') as HTMLButtonElement).click());
    act(() => { ta.blur(); });
    act(() => { ta.focus(); });
    expect(el!.textContent).not.toContain('At 0:42');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => { set.call(ta, 'general note'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await act(async () => { await Promise.resolve(); });
    expect(m.postComment).toHaveBeenCalledWith(expect.objectContaining({ anchor: null }));
    // Posted: the next comment captures the moment again.
    act(() => { ta.blur(); });
    act(() => { ta.focus(); });
    expect(el!.textContent).toContain('At 0:42');
  });
});
