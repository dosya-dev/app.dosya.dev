import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const createTicket = vi.fn();
vi.mock('@/api/support', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/support')>();
  return { ...actual, createTicket: (...a: unknown[]) => createTicket(...a) };
});
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/stores/session', () => ({ useSession: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1', email: 'a@b.c', name: 'A' } }) }));
vi.mock('@/stores/workspace', () => ({ useWorkspace: (sel: (s: unknown) => unknown) => sel({ activeId: 'ws_1' }) }));

const { ReportProblemDialog } = await import('./report-problem-dialog');
const { openReport, useReportProblem } = await import('@/stores/report-problem');

// Base UI's Checkbox re-dispatches the click as a bubbling PointerEvent on its
// hidden <input> sibling; jsdom has no PointerEvent, so alias it to MouseEvent
// (same shim as select-checkbox.test.tsx / provider-picker-dialog.test.tsx).
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const w = window as unknown as { PointerEvent?: typeof MouseEvent; MouseEvent: typeof MouseEvent };
  if (!w.PointerEvent) { w.PointerEvent = w.MouseEvent; }
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove(); root = null; container = null;
  createTicket.mockReset();
  act(() => useReportProblem.getState().closeReport());
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter initialEntries={['/files']}><ReportProblemDialog /></MemoryRouter>);
  });
}

const q = <T extends Element>(sel: string) => document.body.querySelector<T>(sel);
const byText = (text: string) => [...document.body.querySelectorAll('button, label, div, span, p')].find((el) => el.textContent?.trim() === text);

describe('ReportProblemDialog', () => {
  it('renders nothing until opened', async () => {
    await mount();
    expect(q('[role="dialog"]')).toBeNull();
  });

  it('opens with the prefilled error reference in the card, labelled without the vendor', async () => {
    await mount();
    await act(async () => { openReport({ errorRef: 'ref_abc', errorMessage: 'boom' }); });
    const dialog = q('[role="dialog"]')!;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Error reference');
    expect(dialog.textContent).toContain('ref_abc');
    expect(dialog.textContent?.toLowerCase()).not.toContain('sentry');
  });

  it('sends a bug ticket with the text, the workspace and the diagnostics JSON', async () => {
    createTicket.mockResolvedValue({ ok: true, ticket: { id: 't_1', subject: 's' } });
    await mount();
    await act(async () => { openReport({ errorRef: 'ref_abc' }); });
    const ta = q<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(ta, 'The folder list went blank');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { (byText('Send report') as HTMLButtonElement).click(); });
    expect(createTicket).toHaveBeenCalledTimes(1);
    const arg = createTicket.mock.calls[0][0] as { category: string; subject: string; body: string; workspaceId?: string; diagnostics?: string };
    expect(arg.category).toBe('bug');
    expect(arg.subject).toBe('');
    expect(arg.body).toBe('The folder list went blank');
    expect(arg.workspaceId).toBe('ws_1');
    const d = JSON.parse(arg.diagnostics!) as { error_ref: string; client: string; page: string };
    expect(d.error_ref).toBe('ref_abc');
    expect(d.client).toBe('web');
    expect(d.page).toBe('/files');
    expect(q('[role="dialog"]')).toBeNull();
  });

  it('sends NO diagnostics when Include is unticked', async () => {
    createTicket.mockResolvedValue({ ok: true, ticket: { id: 't_1', subject: 's' } });
    await mount();
    await act(async () => { openReport(); });
    const ta = q<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, 'x');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { q<HTMLButtonElement>('[data-testid="include-diagnostics"]')!.click(); });
    await act(async () => { (byText('Send report') as HTMLButtonElement).click(); });
    const arg = createTicket.mock.calls[0][0] as { diagnostics?: string };
    expect(arg.diagnostics).toBeUndefined();
  });

  it('keeps the dialog open and the text intact when the request fails', async () => {
    createTicket.mockRejectedValue(new Error('API 500: nope'));
    await mount();
    await act(async () => { openReport(); });
    const ta = q<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, 'keep me');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { (byText('Send report') as HTMLButtonElement).click(); });
    expect(q('[role="dialog"]')).toBeTruthy();
    expect(q<HTMLTextAreaElement>('textarea')!.value).toBe('keep me');
  });

  it('disables Send while the text is empty', async () => {
    await mount();
    await act(async () => { openReport(); });
    expect((byText('Send report') as HTMLButtonElement).disabled).toBe(true);
  });
});
