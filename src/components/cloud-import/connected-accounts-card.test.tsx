import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CloudAccount } from '@/api/cloud-import';

const listAccountsMock = vi.fn();
const disconnectAccountMock = vi.fn();
vi.mock('@/api/cloud-import', () => ({
  listAccounts: (...args: unknown[]) => listAccountsMock(...args),
  disconnectAccount: (...args: unknown[]) => disconnectAccountMock(...args),
}));

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock('@/lib/toast', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
    info: vi.fn(),
  },
}));

const { ConnectedAccountsCard } = await import('./connected-accounts-card');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flush(ticks = 20) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

const ACCOUNTS: CloudAccount[] = [
  { id: 'cca_g', provider: 'google', account_email: 'g@example.com', account_name: 'G', created_at: 0 },
  { id: 'cca_o', provider: 'onedrive', account_email: 'o@example.com', account_name: 'O', created_at: 100 },
];

async function render(provider: string, onImport?: (accountId: string) => void) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(ConnectedAccountsCard, { provider, onImport }));
    await flush();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listAccountsMock.mockResolvedValue(ACCOUNTS);
  disconnectAccountMock.mockResolvedValue({ ok: true });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
    await flush();
  });
  container?.remove();
  root = null;
  container = null;
});

describe('ConnectedAccountsCard', () => {
  it('shows only the given provider\'s accounts, with email and connection date', async () => {
    await render('onedrive');

    expect(container!.textContent).toContain('o@example.com');
    expect(container!.textContent).toContain('Connected');
    // The google account must not leak into the onedrive card.
    expect(container!.textContent).not.toContain('g@example.com');
  });

  it('shows the empty state once loaded with no matching accounts', async () => {
    listAccountsMock.mockResolvedValue([ACCOUNTS[0]]);
    await render('onedrive');

    expect(container!.textContent).toContain('No OneDrive account connected yet.');
  });

  it('disconnects an account and refetches the list', async () => {
    await render('onedrive');
    expect(listAccountsMock).toHaveBeenCalledTimes(1);

    const button = [...container!.querySelectorAll('button')]
      .find((b) => b.textContent === 'Disconnect')!;
    listAccountsMock.mockResolvedValue([ACCOUNTS[0]]);
    await act(async () => {
      button.click();
      await flush();
    });

    expect(disconnectAccountMock).toHaveBeenCalledWith('cca_o');
    expect(listAccountsMock).toHaveBeenCalledTimes(2);
    expect(toastSuccessMock).toHaveBeenCalled();
    expect(container!.textContent).toContain('No OneDrive account connected yet.');
  });

  it('shows an Import button per account when onImport is given, calling it with the account id', async () => {
    const onImport = vi.fn();
    await render('onedrive', onImport);

    const button = [...container!.querySelectorAll('button')]
      .find((b) => b.textContent === 'Import')!;
    expect(button).toBeTruthy();
    await act(async () => {
      button.click();
      await flush();
    });

    expect(onImport).toHaveBeenCalledWith('cca_o');
  });

  it('shows no Import button without onImport', async () => {
    await render('onedrive');
    expect([...container!.querySelectorAll('button')].some((b) => b.textContent === 'Import')).toBe(false);
  });
});
