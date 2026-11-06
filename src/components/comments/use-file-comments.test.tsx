import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('./api', () => ({ listComments: list }));
const { useFileComments, clearThreadCache } = await import('./use-file-comments');
import type { Comment } from './types';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null; let el: HTMLDivElement | null = null;
beforeEach(() => { list.mockReset(); clearThreadCache(); });
afterEach(() => { if (root) act(() => root!.unmount()); el?.remove(); root = null; });

const cm = (id: string) => ({ id } as Comment);
const seen: string[][] = [];
function Probe({ fileId }: { fileId: string }) {
  const t = useFileComments(fileId, 'ws');
  seen.push(t.comments.map((c) => c.id));
  return createElement('div', { 'data-ids': t.comments.map((c) => c.id).join(','), 'data-loading': String(t.loading) });
}
const mount = (fileId: string) => {
  el = document.createElement('div'); document.body.append(el); root = createRoot(el);
  act(() => root!.render(createElement(Probe, { fileId })));
};
const rerender = (fileId: string) => act(() => root!.render(createElement(Probe, { fileId })));
const ids = () => el!.firstElementChild!.getAttribute('data-ids');

describe('useFileComments', () => {
  it('never returns the previous file comments, even on the first render after a change', async () => {
    list.mockImplementation(async (f: string) => [cm(`c_${f}`)]);
    mount('A');
    await act(async () => { await Promise.resolve(); });
    expect(ids()).toBe('c_A');
    seen.length = 0;
    rerender('B');
    expect(seen.every((s) => !s.includes('c_A'))).toBe(true);
    await act(async () => { await Promise.resolve(); });
    expect(ids()).toBe('c_B');
  });

  it('ignores a slow response for a previous file', async () => {
    let resolveA!: (v: Comment[]) => void;
    list.mockImplementation((f: string) => f === 'A' ? new Promise((r) => { resolveA = r; }) : Promise.resolve([cm('c_B')]));
    mount('A');
    rerender('B');
    await act(async () => { await Promise.resolve(); });
    expect(ids()).toBe('c_B');
    await act(async () => { resolveA([cm('c_A')]); await Promise.resolve(); });
    expect(ids()).toBe('c_B');
  });

  it('reopening a file shows its last thread at once, then the fresh one', async () => {
    list.mockImplementation(async (f: string) => [cm(`c_${f}`)]);
    mount('A');
    await act(async () => { await Promise.resolve(); });
    rerender('B');
    await act(async () => { await Promise.resolve(); });
    expect(ids()).toBe('c_B');

    let resolveA!: (v: Comment[]) => void;
    list.mockImplementation((f: string) => f === 'A' ? new Promise((r) => { resolveA = r; }) : Promise.resolve([cm('c_B')]));
    seen.length = 0;
    rerender('A');
    // The very first render back on A already shows A's cached thread, not loading.
    expect(seen[0]).toEqual(['c_A']);
    expect(el!.firstElementChild!.getAttribute('data-loading')).toBe('false');
    await act(async () => { resolveA([cm('c_A'), cm('c_A2')]); await Promise.resolve(); });
    expect(ids()).toBe('c_A,c_A2');
  });

  it('a file never opened still shows the loading state', async () => {
    list.mockImplementation(() => new Promise(() => {}));
    mount('Z');
    expect(ids()).toBe('');
    expect(el!.firstElementChild!.getAttribute('data-loading')).toBe('true');
  });
});
