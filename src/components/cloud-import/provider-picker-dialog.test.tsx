import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ApiError } from '@/api/client';
import type { CloudAccount, CloudEntryDto } from '@/api/cloud-import';

const listAccountsMock = vi.fn();
const browseMock = vi.fn();
vi.mock('@/api/cloud-import', () => ({
  listAccounts: (...args: unknown[]) => listAccountsMock(...args),
  browse: (...args: unknown[]) => browseMock(...args),
}));

const { ProviderPickerDialog } = await import('./provider-picker-dialog');
const { useCloudImports } = await import('@/stores/cloud-imports');
const { useWorkspace } = await import('@/stores/workspace');

// Base UI's Checkbox re-dispatches the click as a bubbling PointerEvent on its
// hidden <input> sibling; jsdom has no PointerEvent, so alias it to MouseEvent
// (same fix as select-checkbox.test.tsx).
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const w = window as unknown as { PointerEvent?: typeof MouseEvent; MouseEvent: typeof MouseEvent };
  if (!w.PointerEvent) {
    w.PointerEvent = w.MouseEvent;
  }
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flush(ticks = 20) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
  // React 19 can schedule some effect flushing via a macrotask (MessageChannel),
  // which a microtask-only drain above won't catch - hop a real macrotask too.
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  listAccountsMock.mockReset();
  browseMock.mockReset();
  useWorkspace.setState({ activeId: 'ws1' });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function account(over: Partial<CloudAccount> = {}): CloudAccount {
  return {
    id: 'acc1', provider: 'google', account_email: 'user@example.com',
    account_name: 'User', created_at: 0, ...over,
  };
}

function cloudEntry(over: Partial<CloudEntryDto> = {}): CloudEntryDto {
  return { id: 'e1', name: 'Report.pdf', kind: 'file', size: 100, ...over };
}

async function renderDialog(props: Partial<Parameters<typeof ProviderPickerDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(ProviderPickerDialog, {
      open: true,
      onOpenChange,
      provider: 'google',
      destFolderId: null,
      ...props,
    }));
    await flush();
  });
  return { onOpenChange };
}

function findButton(text: string): HTMLButtonElement {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`button "${text}" not found. Buttons on screen: ${
    [...document.querySelectorAll('button')].map((b) => JSON.stringify(b.textContent?.trim())).join(', ')
  }`);
  return btn as HTMLButtonElement;
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
  });
}

describe('ProviderPickerDialog - no account connected', () => {
  it('offers a connect link built from the real /api/cloud/connect/:provider route, not a listing', async () => {
    listAccountsMock.mockResolvedValue([]);
    await renderDialog();
    expect(document.body.textContent).toContain('No account connected yet.');
    const link = document.querySelector('a[href$="/api/cloud/connect/google"]');
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain('Connect an account');
  });
});

describe('ProviderPickerDialog - selection and import', () => {
  it('disables Import with an empty selection, and enables it once something is checked', async () => {
    listAccountsMock.mockResolvedValue([account()]);
    browseMock.mockResolvedValue({ entries: [cloudEntry({ id: 'f1', name: 'a.pdf' })], cursor: null });
    await renderDialog();

    const importBtn = findButton('Import');
    expect(importBtn.disabled).toBe(true);

    const checkbox = document.querySelector<HTMLElement>('[role="checkbox"]');
    expect(checkbox).not.toBeNull();
    await click(checkbox!);

    expect(findButton('Import').disabled).toBe(false);
  });

  it('Import calls start() with the exact { accountId, workspaceId, destFolderId, selection } shape, then closes', async () => {
    listAccountsMock.mockResolvedValue([account({ id: 'acc7' })]);
    browseMock.mockResolvedValue({
      entries: [cloudEntry({ id: 'f1', name: 'a.pdf', kind: 'file', size: 42 })],
      cursor: null,
    });
    const startMock = vi.fn().mockResolvedValue('job1');
    const previousStart = useCloudImports.getState().start;
    useCloudImports.setState({ start: startMock });

    try {
      const { onOpenChange } = await renderDialog({ destFolderId: 'dest1' });

      await click(document.querySelector<HTMLElement>('[role="checkbox"]')!);
      await click(findButton('Import'));

      expect(startMock).toHaveBeenCalledTimes(1);
      expect(startMock).toHaveBeenCalledWith({
        accountId: 'acc7',
        workspaceId: 'ws1',
        destFolderId: 'dest1',
        selection: [
          { id: 'f1', name: 'a.pdf', kind: 'file', size: 42, mimeType: undefined, exportMime: null },
        ],
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    } finally {
      useCloudImports.setState({ start: previousStart });
    }
  });

  it('an unsupported entry renders a disabled checkbox that cannot be checked', async () => {
    listAccountsMock.mockResolvedValue([account()]);
    browseMock.mockResolvedValue({
      entries: [cloudEntry({ id: 'bad1', name: 'weird.xyz', unsupported: true })],
      cursor: null,
    });
    await renderDialog();

    const checkbox = document.querySelector<HTMLElement>('[role="checkbox"]');
    expect(checkbox).not.toBeNull();
    expect(checkbox!.getAttribute('data-disabled')).not.toBeNull();

    await click(checkbox!);
    expect(findButton('Import').disabled).toBe(true);
    expect(document.body.textContent).toContain('Cannot be imported');
  });
});

describe('ProviderPickerDialog - RECONNECT_REQUIRED', () => {
  it('replaces the listing with a reconnect prompt instead of an empty folder', async () => {
    listAccountsMock.mockResolvedValue([account()]);
    browseMock.mockRejectedValue(
      new ApiError(401, JSON.stringify({ ok: false, error: 'Reconnect needed', code: 'RECONNECT_REQUIRED' })),
    );
    await renderDialog();

    expect(document.body.textContent).toContain('needs to be reconnected');
    expect(document.body.textContent).not.toContain('This folder is empty.');
    const link = document.querySelector('a[href$="/api/cloud/connect/google"]');
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain('Reconnect');
  });
});
