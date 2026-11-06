import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { RatingCard } = await import('./rating-card');

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); container?.remove(); root = null; });

async function mount(props: Record<string, unknown>) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(RatingCard, { name: 'Ada', rating: null, closed: false, onRate: async () => {}, ...props } as never)); });
}
const stars = () => Array.from(container!.querySelectorAll<HTMLElement>('[aria-label$="of 5 stars"]'));

describe('RatingCard', () => {
  it('moves the star selection with the arrow keys', async () => {
    await mount({});
    expect(stars()).toHaveLength(5);
    await act(async () => { stars()[0].click(); });
    await act(async () => { stars()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(stars()[1].getAttribute('aria-checked')).toBe('true');
    await act(async () => { stars()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
    expect(stars()[0].getAttribute('aria-checked')).toBe('true');
  });

  it('keeps Send disabled until stars and solved are chosen, and caps the comment at 500', async () => {
    const onRate = vi.fn(async () => {});
    await mount({ onRate });
    const send = () => Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Send')!;
    expect(send().disabled).toBe(true);
    expect(container!.querySelector('textarea')!.maxLength).toBe(500);
  });

  it('keeps a saved rating editable inside the window: thanks line, prefilled choices, Send once something changed', async () => {
    const onRate = vi.fn(async () => {});
    await mount({ rating: { stars: 3, solved: false, comment: 'ok', created_at: 1 }, onRate });
    expect(container!.textContent).toContain('Thanks for your feedback');
    expect(stars().every((s) => s.tagName === 'BUTTON')).toBe(true);
    expect(stars()[2].getAttribute('aria-checked')).toBe('true');
    const pill = (txt: string) => Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === txt)!;
    expect(pill('No').getAttribute('aria-pressed')).toBe('true');
    expect(container!.querySelector('textarea')!.value).toBe('ok');
    const send = () => pill('Send');
    expect(send().disabled).toBe(true);
    await act(async () => { stars()[4].click(); });
    expect(send().disabled).toBe(false);
    await act(async () => { send().click(); });
    expect(onRate).toHaveBeenCalledWith(5, false, 'ok');
  });

  it('shows a saved rating read-only once the window has closed', async () => {
    await mount({ rating: { stars: 3, solved: false, comment: 'ok', created_at: 1 }, closed: true });
    expect(container!.textContent).toContain('Thanks for your feedback');
    expect(container!.textContent).toContain('Not solved');
    expect(container!.querySelector('textarea')).toBeNull();
    expect(stars().every((s) => s.tagName !== 'BUTTON')).toBe(true);
  });

  it('is read-only when the rating window has closed', async () => {
    await mount({ closed: true });
    expect(container!.querySelector('textarea')).toBeNull();
    expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'Send')).toBe(false);
  });
});
