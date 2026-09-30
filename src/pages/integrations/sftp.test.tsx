import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

// The page only needs to know whether the RESOLVED map says no; the rest of
// usePermissions is irrelevant here, as is the snippet context.
const permsMock = vi.fn();
vi.mock('@/hooks/use-permissions', () => ({ usePermissions: () => permsMock() }));
vi.mock('@/hooks/use-integration-ctx', () => ({
  useIntegrationCtx: () => ({ workspaceId: 'ws1', workspaceName: 'Acme', email: 'me@example.com' }),
}));

const { default: SftpSetup } = await import('./sftp');

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
  permsMock.mockReset();
});

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter><SftpSetup /></MemoryRouter>);
    await Promise.resolve();
  });
}

const NOTICE = 'Your role can’t use SFTP';

describe('SftpSetup - role without access_sftp', () => {
  it('says so once the permission map has resolved and lacks access_sftp', async () => {
    permsMock.mockReturnValue({ can: (p: string) => p !== 'access_sftp', isResolved: true });
    await render();
    expect(container!.textContent).toContain(NOTICE);
  });

  it('shows nothing while the map is unresolved, because the hook fails open', async () => {
    permsMock.mockReturnValue({ can: () => true, isResolved: false });
    await render();
    expect(container!.textContent).not.toContain(NOTICE);
  });

  it('shows nothing for a role that holds access_sftp', async () => {
    permsMock.mockReturnValue({ can: () => true, isResolved: true });
    await render();
    expect(container!.textContent).not.toContain(NOTICE);
    // The walkthrough itself still renders either way.
    expect(container!.textContent).toContain('Connect from the terminal');
  });
});
