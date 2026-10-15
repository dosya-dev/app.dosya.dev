import { afterEach, beforeAll, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CommentBody } from './comment-body';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null; let el: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); el?.remove(); root = null; });

it('highlights mentions and renders markup as text', () => {
  el = document.createElement('div'); document.body.append(el); root = createRoot(el);
  act(() => root!.render(createElement(CommentBody, { body: '<b>x</b> @Ayşe Kaya', mentions: [{ id: 'u', name: 'Ayşe Kaya' }] })));
  expect(el.querySelector('b')).toBeNull();
  expect(el.textContent).toBe('<b>x</b> @Ayşe Kaya');
  expect(el.querySelector('[data-mention]')?.textContent).toBe('@Ayşe Kaya');
});
