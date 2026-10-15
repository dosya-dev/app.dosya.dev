import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Settings, Connected AI apps: lists the AI assistants a person allowed to
 * read a workspace and disconnects one. Disconnect must name the exact row,
 * and a failed load must say so instead of claiming nothing is connected.
 */
const reqMock = vi.fn();
vi.mock('@/api/req', () => ({ req: (...args: unknown[]) => reqMock(...args) }));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('@/lib/toast', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import AiAppsPage from './ai-apps';

const CLAUDE = { id: 'grant_1', clientName: 'Claude', workspaceId: 'ws_1', workspaceName: 'Acme', scopes: ['files.read', 'account.read'], createdAt: 1_760_000_000 };
const GPT = { id: 'grant_2', clientName: 'ChatGPT', workspaceId: 'ws_2', workspaceName: 'Side project', scopes: ['files.read'], createdAt: 1_760_000_000 };

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('Connected AI apps', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    reqMock.mockReset(); toastSuccess.mockReset(); toastError.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  const mount = async () => {
    root = createRoot(container!);
    await act(async () => { root!.render(<AiAppsPage />); });
  };
  const text = () => container!.textContent ?? '';
  const disconnectButtons = () => Array.from(container!.querySelectorAll('button')).filter((b) => b.textContent?.includes('Disconnect'));

  it('lists each connection with its workspace and what it may read', async () => {
    reqMock.mockResolvedValueOnce({ ok: true, connections: [CLAUDE, GPT] });
    await mount();
    expect(reqMock).toHaveBeenCalledWith('/api/me/ai-connections');
    expect(text()).toContain('Claude');
    expect(text()).toContain('Acme');
    expect(text()).toContain('Plan and storage');
    expect(text()).toContain('ChatGPT');
    expect(disconnectButtons()).toHaveLength(2);
  });

  it('shows how to connect when nothing is connected', async () => {
    reqMock.mockResolvedValueOnce({ ok: true, connections: [] });
    await mount();
    expect(text()).toContain('No AI apps are connected');
    expect(text()).toContain('https://mcp.dosya.dev/mcp');
  });

  it('says loading failed instead of claiming nothing is connected', async () => {
    reqMock.mockResolvedValueOnce({ ok: false, error: 'Service temporarily unavailable' });
    await mount();
    expect(text()).toContain('Service temporarily unavailable');
    expect(text()).not.toContain('No AI apps are connected');
  });

  it('disconnects exactly the row clicked, then reloads', async () => {
    reqMock.mockResolvedValueOnce({ ok: true, connections: [CLAUDE, GPT] });
    await mount();
    reqMock.mockResolvedValueOnce({ ok: true });
    reqMock.mockResolvedValueOnce({ ok: true, connections: [CLAUDE] });
    await act(async () => { disconnectButtons()[1].click(); });
    expect(reqMock).toHaveBeenCalledWith('/api/me/ai-connections/grant_2', { method: 'DELETE' });
    expect(toastSuccess).toHaveBeenCalled();
    expect(text()).not.toContain('Side project');
    expect(disconnectButtons()).toHaveLength(1);
  });

  it('reports a failed disconnect and keeps the row', async () => {
    reqMock.mockResolvedValueOnce({ ok: true, connections: [CLAUDE] });
    await mount();
    reqMock.mockResolvedValueOnce({ ok: false, error: 'Not found' });
    await act(async () => { disconnectButtons()[0].click(); });
    expect(toastError).toHaveBeenCalledWith('Disconnect failed', 'Not found');
    expect(text()).toContain('Claude');
  });
});
