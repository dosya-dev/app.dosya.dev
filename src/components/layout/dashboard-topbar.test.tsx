import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/components/ui/sidebar', () => ({ SidebarTrigger: () => null }));
vi.mock('../notifications/notification-bell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/onboarding/setup-pill', () => ({ SetupPill: () => null }));
vi.mock('./profile-menu', () => ({ ProfileMenu: () => null }));
vi.mock('./global-search', () => ({ GlobalSearch: () => null }));

import { DashboardTopbar } from './dashboard-topbar';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
});

describe('DashboardTopbar language picker', () => {
  it('shows the language menu in the signed-in top bar', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(<MemoryRouter><DashboardTopbar /></MemoryRouter>); });
    expect(container.querySelector('[data-testid=language-menu-button]')).not.toBeNull();
  });
});
