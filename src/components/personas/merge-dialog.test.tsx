import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { MergeDialog } = await import('./merge-dialog');
const { FakeEngine, card } = await import('@/lib/personas-device/__fixtures__/fake-host');
type PersonaCard = import('@/lib/personas').PersonaCard;
type Engine = import('@dosya-dev/personas-engine').PersonasEngine;

const EMMA: PersonaCard = card('p1', 'Emma', { face_count: 30, photo_count: 412 });
const LIST: PersonaCard[] = [
  EMMA,
  card('p2', null, { face_count: 41, photo_count: 41 }),
  card('p3', 'Leo', { face_count: 20, photo_count: 248 }),
];
let engine: InstanceType<typeof FakeEngine>;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const w = window as unknown as { PointerEvent?: typeof MouseEvent; MouseEvent: typeof MouseEvent };
  if (!w.PointerEvent) w.PointerEvent = w.MouseEvent;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let onMerged: ReturnType<typeof vi.fn<(id: string) => void>>;

beforeEach(() => {
  engine = new FakeEngine();
  engine.personas = LIST.map((p) => ({ ...p }));
  onMerged = vi.fn<(id: string) => void>();
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
  document.body.innerHTML = '';
});

const flush = async () => { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); };

async function mount(target = EMMA) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MergeDialog open engine={engine as unknown as Engine} target={target} onClose={() => {}} onMerged={onMerged} />);
  });
  await flush();
}

const dialog = () => document.querySelector('[role="dialog"]')!;
const button = (label: string) => [...dialog().querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

describe('MergeDialog', () => {
  it('names the target, says it keeps its name and cover, and lists the other personas', async () => {
    await mount();
    expect(dialog().querySelector('h2')!.textContent).toBe('Merge with Emma');
    expect(dialog().textContent).toContain('Pick the persona that is also Emma. Its photos move to Emma and Emma keeps the name and cover.');
    const options = [...dialog().querySelectorAll('[role="radio"]')];
    expect(options).toHaveLength(2);
    expect(dialog().textContent).toContain('Unnamed');
    expect(dialog().textContent).toContain('41 photos');
    expect(dialog().textContent).toContain('Leo');
    // Nothing picked yet: the merge button waits.
    expect(button('Merge into Emma')!.disabled).toBe(true);
  });

  it('merges the picked persona into the target', async () => {
    await mount();
    await act(async () => { (dialog().querySelectorAll('[role="radio"]')[0] as HTMLElement).click(); });
    await flush();
    expect(button('Merge into Emma')!.disabled).toBe(false);
    await act(async () => { button('Merge into Emma')!.click(); });
    await flush();
    expect(engine.merge).toHaveBeenCalledWith('p1', 'p2');
    expect(onMerged).toHaveBeenCalledWith('p1');
  });

  it('keeps the dialog open with a message when the merge fails', async () => {
    engine.merge.mockRejectedValueOnce(new Error('offline'));
    await mount();
    await act(async () => { (dialog().querySelectorAll('[role="radio"]')[0] as HTMLElement).click(); });
    await act(async () => { button('Merge into Emma')!.click(); });
    await flush();
    expect(dialog().textContent).toContain('The personas could not be merged. Try again.');
    expect(onMerged).not.toHaveBeenCalled();
  });

  it('for an unnamed target, says a named pick keeps its name', async () => {
    await mount(LIST[1]);
    expect(dialog().querySelector('h2')!.textContent).toBe('Merge with this persona');
    expect(dialog().textContent).toContain('If the one you pick has a name, it keeps the name and cover.');
    expect(button('Merge')).toBeTruthy();
  });

  it('uses no gendered pronoun', async () => {
    await mount();
    expect(dialog().textContent).not.toMatch(/\b(her|his|she|he)\b/i);
  });
});
