import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const vpn = vi.hoisted(() => ({ available: false }));
vi.mock('@/hooks/use-vpn-available', () => ({ useVpnAvailable: () => vpn.available }));

import IntegrationsPage from './integrations';

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
});

function render(): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter>
        <IntegrationsPage />
      </MemoryRouter>,
    );
  });
  return container;
}

// The VPN lives on the Integrations page (built-in tools), not in the sidebar.
describe('IntegrationsPage VPN card', () => {
  it('shows a VPN card linking to /vpn when the VPN is available to this user', () => {
    vpn.available = true;
    const el = render();
    expect(el.querySelector('a[href="/vpn"]')).not.toBeNull();
  });

  it('hides the VPN card while the rollout gate is closed', () => {
    vpn.available = false;
    const el = render();
    expect(el.querySelector('a[href="/vpn"]')).toBeNull();
  });
});
