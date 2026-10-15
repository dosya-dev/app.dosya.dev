// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from './toast';

beforeEach(() => { document.body.innerHTML = ''; vi.useFakeTimers(); });

const toasts = () => [...document.querySelectorAll('.dosya-toast')];

describe('toast actions', () => {
  it('renders an action button that runs the handler and removes the toast at once', () => {
    const onClick = vi.fn();
    toast.error('Upload failed', 'Could not start upload', { action: { label: 'Report', onClick } });
    const btn = document.querySelector<HTMLButtonElement>('.dosya-toast__action')!;
    expect(btn.textContent).toBe('Report');
    btn.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    // Gone immediately, so a second click cannot open two dialogs.
    expect(document.querySelector('.dosya-toast__action')).toBeNull();
    vi.runAllTimers();
    expect(toasts()).toHaveLength(0);
  });

  it('still auto-dismisses when the action is never clicked, after the longer action duration', () => {
    toast.error('Upload failed', 'x', { action: { label: 'Report', onClick: () => {} } });
    expect(toasts()).toHaveLength(1);
    vi.advanceTimersByTime(8000 + 300 + 200);
    expect(toasts()).toHaveLength(0);
  });

  it('renders no button without an action, exactly as before', () => {
    toast.success('Saved');
    expect(document.querySelector('.dosya-toast__action')).toBeNull();
  });

  it('a plain toast with no action still dismisses at the normal 4s duration', () => {
    toast.success('Saved');
    expect(toasts()).toHaveLength(1);
    vi.advanceTimersByTime(4000 + 300 + 200);
    expect(toasts()).toHaveLength(0);
  });
});
