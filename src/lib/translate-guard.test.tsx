import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { installTranslateGuard } from './translate-guard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Chrome's page translation detaches every text node and puts a <font> holding
// the translated string where it was. React still owns the detached node, so
// removing or reordering a bare text child throws NotFoundError and the
// router's error page replaces the screen (Sentry 149714040: /profile on
// 09-28, fixed for that page only; /welcome again on 10-20).
function translate(el: Element) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  for (const t of texts) {
    const font = document.createElement('font');
    font.textContent = `譯:${t.data}`;
    t.parentNode!.replaceChild(font, t);
  }
}

function Count({ n, extra }: { n: number; extra: boolean }) {
  return (
    <p>
      {n} file{n === 1 ? null : 's'}
      {extra ? <b>new</b> : null}
      {extra ? ' ready' : null}
    </p>
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('installTranslateGuard', () => {
  beforeAll(() => installTranslateGuard());

  it('keeps a translated page rendering when React removes and inserts text nodes the translator moved', () => {
    const uncaught: unknown[] = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container, { onUncaughtError: (e) => { uncaught.push(e); } });
    act(() => root!.render(<Count n={2} extra={false} />));
    translate(container);

    act(() => root!.render(<Count n={1} extra />));
    act(() => root!.render(<Count n={3} extra={false} />));

    expect(uncaught).toEqual([]);
    expect(container.querySelector('p')).not.toBeNull();
  });

  it('turns a remove or insert against a non-child into a no-op or an append', () => {
    const parent = document.createElement('div');
    const stranger = document.createElement('span');
    expect(() => parent.removeChild(stranger)).not.toThrow();
    expect(() => parent.insertBefore(document.createElement('i'), stranger)).not.toThrow();
    // Both fall back to safe outcomes: nothing removed, the node appended.
    expect(parent.childNodes).toHaveLength(1);
  });

  it('is idempotent', () => {
    const before = Node.prototype.removeChild;
    installTranslateGuard();
    expect(Node.prototype.removeChild).toBe(before);
  });
});
