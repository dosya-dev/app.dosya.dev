import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import('@/api/client')>()).ApiError,
  api,
  apiErrorMessage: String,
}));
import { ApiError } from '@/api/client';
import { DeleteAccountNowDialog } from './delete-account-now-dialog';

const PREVIEW = {
  workspaces: [{ id: 'ws', name: 'Solo' }], file_count: 12, total_bytes: 1, blockers: [],
  window_days: 30, deletion_scheduled_for: 2_000_000_000,
};

function byTestId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.querySelector<T>(`[data-testid="${id}"]`);
  expect(el, `missing [data-testid="${id}"]`).not.toBeNull();
  return el!;
}

async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('DeleteAccountNowDialog', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const onDeleted = vi.fn();

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onDeleted.mockReset();
    api.mockReset();
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  const render = (hasPassword: boolean) => act(async () => {
    root.render(
      <DeleteAccountNowDialog
        open onOpenChange={() => {}} preview={PREVIEW} scheduledFor={2_000_000_000}
        hasPassword={hasPassword} onDeleted={onDeleted}
      />,
    );
  });

  it('password account: asks for the password, sends no code, posts delete-now with it', async () => {
    api.mockResolvedValue({ ok: true, erasure_started: true });
    await render(true);

    expect(document.querySelector('[data-testid="delete-now-code"]')).toBeNull();
    expect(api).not.toHaveBeenCalledWith('/api/me/delete-request', expect.anything());

    const confirm = byTestId<HTMLButtonElement>('delete-now-confirm');
    expect(confirm.disabled).toBe(true);

    await type(byTestId<HTMLInputElement>('delete-now-password'), 'hunter2');
    expect(confirm.disabled).toBe(false);
    await act(async () => { confirm.click(); });

    expect(api).toHaveBeenCalledWith('/api/me/delete-now', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ password: 'hunter2' }),
    }));
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('OAuth account: mails a code on open and posts delete-now with the code', async () => {
    api.mockResolvedValue({ ok: true });
    await render(false);

    expect(api).toHaveBeenCalledWith('/api/me/delete-request', expect.objectContaining({ method: 'POST' }));
    expect(document.querySelector('[data-testid="delete-now-password"]')).toBeNull();

    const confirm = byTestId<HTMLButtonElement>('delete-now-confirm');
    await type(byTestId<HTMLInputElement>('delete-now-code'), '12 34-56');
    expect(confirm.disabled).toBe(false);
    await act(async () => { confirm.click(); });

    expect(api).toHaveBeenCalledWith('/api/me/delete-now', expect.objectContaining({
      body: JSON.stringify({ code: '123456' }),
    }));
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('a wrong password shows the error, clears the field and does not complete', async () => {
    api.mockRejectedValue(new ApiError(403, '{"error":"Password is incorrect"}'));
    await render(true);

    const input = byTestId<HTMLInputElement>('delete-now-password');
    await type(input, 'nope');
    await act(async () => { byTestId<HTMLButtonElement>('delete-now-confirm').click(); });

    expect(byTestId('delete-now-error').textContent).toMatch(/password is not correct/i);
    expect(input.value).toBe('');
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
