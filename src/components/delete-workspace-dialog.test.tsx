import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', async (importOriginal) => ({
  // shouldRetryQuery does `error instanceof ApiError` on every retry, and a retry
  // can outlive the test that started it - a mock without it throws and fails the run.
  ApiError: (await importOriginal<typeof import('@/api/client')>()).ApiError,
  api,
  apiErrorMessage: String,
}));
import { DeleteWorkspaceDialog } from './delete-workspace-dialog';

describe('workspace deletion completion contract', () => {
  it.each([true, false])('passes pending=%s to the caller after the confirmation gate', async (pending) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/delete-preview')) return { ok: true, workspace_name: 'Team', file_count: 1, total_bytes: 1, folder_count: 0, member_count: 0, blockers: [] };
      if (init?.method === 'DELETE') return { ok: true, pending, operation_id: pending ? 'op_pending' : undefined };
      return { ok: true, sent_to: 'owner@example.test' };
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onDeleted = vi.fn();
    const click = async (label: string) => {
      const button = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === label)!;
      expect(button).toBeDefined();
      await act(async () => { button.click(); });
    };
    const input = async (placeholder: string, value: string) => {
      const element = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    try {
      await act(async () => { root.render(<DeleteWorkspaceDialog open onOpenChange={() => {}} workspaceId="ws" onDeleted={onDeleted} />); });
      await click('Continue');
      await input('000000', '123456');
      await click('Continue');
      await input('Workspace name', 'Team');
      await click('Delete forever');
      expect(onDeleted).toHaveBeenCalledWith(pending);
    } finally {
      await act(async () => { root.unmount(); });
      container.remove();
      api.mockReset();
    }
  });
});
