import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NewFileDialog } from './new-file-dialog';
import type { NewFileKind } from '@/lib/blank-files';

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
  document.body.innerHTML = '';
});

async function render(kind: NewFileKind | null, onCreate = vi.fn().mockResolvedValue(null), onClose = vi.fn()) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(NewFileDialog, { kind, onCreate, onClose }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { onCreate, onClose };
}

const input = () => document.body.querySelector<HTMLInputElement>('input[aria-label="Name"]');
const button = (text: string) => [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
async function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input()!, value); input()!.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('NewFileDialog', () => {
  it('renders nothing while closed', async () => {
    await render(null);
    expect(input()).toBeNull();
  });

  it.each([
    ['md', 'New Markdown file', 'Untitled.md'],
    ['txt', 'New text file', 'Untitled.txt'],
    ['docx', 'New Word document', 'Untitled.docx'],
  ] as const)('%s: title, prefilled name, base name selected', async (kind, title, name) => {
    await render(kind);
    expect(document.body.textContent).toContain(title);
    expect(input()!.value).toBe(name);
    expect([input()!.selectionStart, input()!.selectionEnd]).toEqual([0, 8]);
    expect(document.activeElement).toBe(input());
  });

  it('puts the extension back when it was removed', async () => {
    const { onCreate } = await render('md');
    await type('notes');
    await act(async () => { button('Create')!.click(); });
    expect(onCreate).toHaveBeenCalledWith('notes.md', 'md');
  });

  it('an inline error from onCreate keeps the dialog open', async () => {
    const onCreate = vi.fn().mockResolvedValue('A file with this name already exists.');
    await render('txt', onCreate);
    await act(async () => { input()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onCreate).toHaveBeenCalledWith('Untitled.txt', 'txt');
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('A file with this name already exists.');
    expect(input()).not.toBeNull();
  });

  it('an invalid name is refused before onCreate', async () => {
    const { onCreate } = await render('md');
    await type('a/b');
    await act(async () => { button('Create')!.click(); });
    expect(onCreate).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });

  it('an empty name is refused before onCreate', async () => {
    const { onCreate } = await render('md');
    await type('  ');
    await act(async () => { button('Create')!.click(); });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('Cancel and Escape close it', async () => {
    const { onClose } = await render('docx');
    await act(async () => { button('Cancel')!.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
