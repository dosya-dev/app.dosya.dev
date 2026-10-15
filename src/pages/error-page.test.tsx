import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

const lastEventId = vi.fn<() => string | undefined>(() => undefined);
vi.mock('@sentry/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/react')>();
  return { ...actual, lastEventId: () => lastEventId() };
});
const reportRouteError = vi.fn<(err: unknown) => string | null>(() => null);
vi.mock('@/lib/sentry', () => ({ reportRouteError: (err: unknown) => reportRouteError(err) }));
vi.mock('@/stores/session', () => ({ useSession: (sel: (s: unknown) => unknown) => sel({ user: null }) }));
vi.mock('@/stores/workspace', () => ({ useWorkspace: (sel: (s: unknown) => unknown) => sel({ activeId: '' }) }));
vi.mock('@/api/support', () => ({ createTicket: vi.fn() }));

const { default: ErrorPage } = await import('./error-page');
const { useReportProblem } = await import('@/stores/report-problem');

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove(); root = null; container = null;
  lastEventId.mockReset();
  reportRouteError.mockClear();
  act(() => useReportProblem.getState().closeReport());
});

function Boom(): never { throw new Error('render exploded'); }

async function mountError() {
  const router = createMemoryRouter([{ path: '/', element: <Boom />, errorElement: <ErrorPage /> }], { initialEntries: ['/'] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { root!.render(<RouterProvider router={router} />); });
  errors.mockRestore();
}

const button = (label: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(label)) as HTMLButtonElement | undefined;

describe('ErrorPage reporting', () => {
  it('offers Report this on an unexpected error and opens the dialog with the error reference', async () => {
    lastEventId.mockReturnValue('evt_123');
    await mountError();
    expect(button('Report this')).toBeTruthy();
    await act(async () => { button('Report this')!.click(); });
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('evt_123');
    expect(dialog.textContent).toContain('render exploded');
  });

  it('still offers Report this when there is no event id, and carries null rather than "undefined"', async () => {
    lastEventId.mockReturnValue(undefined);
    await mountError();
    await act(async () => { button('Report this')!.click(); });
    expect(useReportProblem.getState().prefill.errorRef).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')!.textContent).not.toContain('undefined');
  });

  it('uses the id reportRouteError captured for this error, not a stale lastEventId', async () => {
    reportRouteError.mockReturnValueOnce('evt_from_capture');
    lastEventId.mockReturnValue('evt_stale');
    await mountError();
    await act(async () => { button('Report this')!.click(); });
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('evt_from_capture');
    expect(dialog.textContent).not.toContain('evt_stale');
  });
});
