import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { default: ActivityPage } = await import('./activity');
const { useWorkspace } = await import('@/stores/workspace');
const { ApiError } = await import('@/api/client');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useWorkspace.setState({ activeId: 'ws_1' });
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  apiMock.mockReset();
});

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter><ActivityPage /></MemoryRouter>);
    await Promise.resolve();
  });
}

// GET /api/activity answers 403 outright for a role without view_activity (it
// IS the audit trail, so there is no remainder of a page to serve). The page's
// bare `catch {}` turned that, and any network failure, into "No activity
// found" - an empty state over a refusal.
describe('ActivityPage load failure', () => {
  it('renders the server sentence in an error card, not the empty state', async () => {
    apiMock.mockRejectedValue(new ApiError(403, JSON.stringify({ error: "You don't have permission to view the activity log" })));
    await render();
    expect(container!.textContent).toContain("You don't have permission to view the activity log");
    expect(container!.textContent).not.toContain('No activity found');
  });

  it('still shows the empty state for a successful empty feed', async () => {
    apiMock.mockResolvedValue({ ok: true, activities: [], members: [], pagination: { page: 1, per_page: 30, total: 0, total_pages: 0 } });
    await render();
    expect(container!.textContent).toContain('No activity found');
  });
});
