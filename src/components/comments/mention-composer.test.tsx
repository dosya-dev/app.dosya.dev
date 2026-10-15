import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { search } = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('./api', () => ({ searchMentionable: search }));
const { MentionComposer } = await import('./mention-composer');

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null; let el: HTMLDivElement | null = null;
beforeEach(() => { search.mockReset(); vi.useFakeTimers(); });
afterEach(() => { if (root) act(() => root!.unmount()); el?.remove(); root = null; vi.useRealTimers(); });

function type(ta: HTMLTextAreaElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => { set.call(ta, value); ta.setSelectionRange(value.length, value.length); ta.dispatchEvent(new Event('input', { bubbles: true })); });
}
const key = (ta: HTMLTextAreaElement, k: string) =>
  act(() => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });

async function setup(extra: Record<string, unknown> = {}) {
  const onSubmit = vi.fn(async () => true);
  el = document.createElement('div'); document.body.append(el); root = createRoot(el);
  act(() => root!.render(createElement(MentionComposer, { workspaceId: 'ws', fileId: 'f', onSubmit, ...extra })));
  return { ta: el.querySelector('textarea')!, onSubmit };
}

describe('MentionComposer', () => {
  it('@ opens the picker, Enter picks, submit sends the id', async () => {
    search.mockResolvedValue([{ id: 'u_a', name: 'Ayşe Kaya', email: 'a@x', avatar_url: null }]);
    const { ta, onSubmit } = await setup();
    type(ta, 'hi @ay');
    await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve(); });
    expect(search).toHaveBeenCalledWith('ws', 'f', 'ay');
    expect(el!.querySelector('[role="listbox"]')?.textContent).toContain('Ayşe Kaya');
    key(ta, 'Enter');
    expect(ta.value).toBe('hi @Ayşe Kaya ');
    key(ta, 'Enter'); // picker closed now: Enter submits
    await act(async () => { await Promise.resolve(); });
    expect(onSubmit).toHaveBeenCalledWith('hi @Ayşe Kaya', ['u_a']);
  });

  it('deleting the @Name text unmentions', async () => {
    search.mockResolvedValue([{ id: 'u_a', name: 'Ayşe Kaya', email: 'a@x', avatar_url: null }]);
    const { ta, onSubmit } = await setup();
    type(ta, '@ay');
    await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve(); });
    key(ta, 'Enter');
    type(ta, 'never mind');
    key(ta, 'Enter');
    await act(async () => { await Promise.resolve(); });
    expect(onSubmit).toHaveBeenCalledWith('never mind', []);
  });

  it('Escape closes the picker without inserting', async () => {
    search.mockResolvedValue([{ id: 'u_a', name: 'Ayşe Kaya', email: 'a@x', avatar_url: null }]);
    const { ta } = await setup();
    type(ta, '@ay');
    await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve(); });
    key(ta, 'Escape');
    expect(el!.querySelector('[role="listbox"]')).toBeNull();
    expect(ta.value).toBe('@ay');
  });

  it('a failed lookup shows an error row and typing continues', async () => {
    search.mockRejectedValue(new Error('down'));
    const { ta } = await setup();
    type(ta, '@ay');
    await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve(); await Promise.resolve(); });
    expect(el!.textContent).toContain("Couldn't load people");
    type(ta, '@ayx');
    expect(ta.value).toBe('@ayx');
  });

  it('shows the anchor chip and clears it', async () => {
    const onClearAnchor = vi.fn();
    await setup({ anchor: { kind: 'time', ms: 42_000 }, onClearAnchor });
    expect(el!.textContent).toContain('at 0:42');
    act(() => (el!.querySelector('[aria-label="Remove anchor"]') as HTMLButtonElement).click());
    expect(onClearAnchor).toHaveBeenCalled();
  });

  it('Shift+Enter is a newline, not a submit', async () => {
    const { ta, onSubmit } = await setup();
    type(ta, 'line');
    act(() => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })); });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('hides the email when the server sends none (no view_team_members)', async () => {
    search.mockResolvedValue([{ id: 'u_a', name: 'Ayşe Kaya', email: null, avatar_url: null }]);
    const { ta } = await setup();
    type(ta, '@ay');
    await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve(); });
    const row = el!.querySelector('[role="option"]')!;
    expect(row.textContent).toBe('Ayşe Kaya');
  });

  it('counter appears near the cap; over the cap Send is disabled and Enter does nothing', async () => {
    const { ta, onSubmit } = await setup();
    type(ta, 'a'.repeat(4500));
    expect(el!.querySelector('#comment-length')).toBeNull();
    type(ta, 'a'.repeat(4501));
    const counter = el!.querySelector('#comment-length')!;
    expect(counter.textContent).toContain('4,501');
    expect(counter.className).not.toContain('text-destructive');
    type(ta, 'a'.repeat(5001));
    expect(el!.querySelector('#comment-length')!.className).toContain('text-destructive');
    expect((el!.querySelector('button[aria-label="Send"]') as HTMLButtonElement).disabled).toBe(true);
    key(ta, 'Enter');
    await act(async () => { await Promise.resolve(); });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Enter while an IME is composing neither submits nor picks', async () => {
    search.mockResolvedValue([{ id: 'u_a', name: 'Ayşe Kaya', email: 'a@x', avatar_url: null }]);
    const { ta, onSubmit } = await setup();
    type(ta, 'hi @ay');
    await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve(); });
    act(() => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); });
    expect(ta.value).toBe('hi @ay');
    act(() => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    act(() => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true })); });
    await act(async () => { await Promise.resolve(); });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('exposes the textarea through inputRef so a caller can focus it', async () => {
    const inputRef = { current: null as HTMLTextAreaElement | null };
    const { ta } = await setup({ inputRef });
    expect(inputRef.current).toBe(ta);
  });

  it('a lookup answered after the query moved on is dropped', async () => {
    let resolveAy!: (v: unknown) => void;
    search.mockImplementationOnce(() => new Promise((r) => { resolveAy = r; }));
    search.mockResolvedValue([{ id: 'u_l', name: 'Ali Demir', email: 'l@x', avatar_url: null }]);
    const { ta } = await setup();
    type(ta, '@ay');
    await act(async () => { vi.advanceTimersByTime(200); });
    type(ta, '@al'); // same "@" position, different query; its lookup not yet fired
    await act(async () => { resolveAy([{ id: 'u_a', name: 'Ayşe Kaya', email: 'a@x', avatar_url: null }]); await Promise.resolve(); });
    expect(el!.querySelector('[role="listbox"]')).toBeNull();
    key(ta, 'Enter'); // must not pick Ayşe for "@al"
    expect(ta.value).not.toContain('Ayşe');
  });

  it('typing past a shown list clears it until the new answer arrives', async () => {
    search.mockResolvedValue([{ id: 'u_a', name: 'Ayşe Kaya', email: 'a@x', avatar_url: null }]);
    const { ta } = await setup();
    type(ta, '@ay');
    await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve(); });
    expect(el!.querySelector('[role="listbox"]')).not.toBeNull();
    type(ta, '@ayx');
    expect(el!.querySelector('[role="listbox"]')).toBeNull();
  });
});
