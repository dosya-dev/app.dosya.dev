// apps/web/src/pages/tv.test.tsx
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { normalizeTvCode } from '@/lib/tv-code';

/**
 * /tv: where a dosya TV app is signed in. With ?code= it looks the code up,
 * shows the TV and asks Allow / Cancel; without one it asks for the code.
 * Contract: docs/TV-API-CONTRACT.md §1.
 */
const apiMock = vi.fn();
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/api/client', async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import('@/api/client')>()).ApiError,
  API_BASE: '',
  api: (...args: unknown[]) => apiMock(...args),
}));
vi.mock('@/components/public-nav', () => ({ PublicNav: () => <nav /> }));

import { ApiError } from '@/api/client';
import TvPage from './tv';

const LOOKUP = { user_code: 'KDTR-9WMX', device_type: 'Apple TV', device_model: 'AppleTV14,1', location: 'Brisbane, AU', expires_at: 1793845900 };

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('normalizeTvCode', () => {
  it('accepts the code with or without the dash, in any case, and shows it as XXXX-XXXX', () => {
    expect(normalizeTvCode('KDTR-9WMX')).toBe('KDTR-9WMX');
    expect(normalizeTvCode('kdtr9wmx')).toBe('KDTR-9WMX');
    expect(normalizeTvCode(' kdtr 9wmx ')).toBe('KDTR-9WMX');
    expect(normalizeTvCode('kdtr–9wmx')).toBe('KDTR-9WMX');
  });

  it('refuses anything that cannot be a TV code', () => {
    expect(normalizeTvCode('')).toBeNull();
    expect(normalizeTvCode('KDTR-9WM')).toBeNull(); // 7 characters
    expect(normalizeTvCode('KDTR-9WMXX')).toBeNull(); // 9 characters
    expect(normalizeTvCode('KDTO-9WMX')).toBeNull(); // O is not in the alphabet
    expect(normalizeTvCode('KDTR-0WMX')).toBeNull(); // nor is 0
    expect(normalizeTvCode('AEIU-2345')).toBeNull(); // nor are vowels
  });
});

describe('/tv page', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    apiMock.mockReset(); navigate.mockReset(); sessionStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  const mount = async (path: string) => {
    root = createRoot(container!);
    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={[path]}>
          <TvPage />
        </MemoryRouter>,
      );
    });
  };
  const click = async (label: string) => {
    const button = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
    expect(button, label).toBeTruthy();
    await act(async () => { button!.click(); });
  };
  const type = async (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('looks the code up with its normalised form and shows the TV', async () => {
    apiMock.mockResolvedValueOnce(LOOKUP);
    await mount('/tv?code=kdtr9wmx');
    expect(apiMock).toHaveBeenCalledWith('/api/auth/tv/lookup?code=KDTR-9WMX');
    const text = container!.textContent!;
    expect(container!.querySelector('[data-testid="tv-code"]')!.textContent).toBe('KDTR-9WMX');
    expect(text).toContain('Check this matches the code on your TV.');
    expect(text).toContain('Apple TV');
    expect(text).toContain('Device type reported by the TV');
    expect(text).toContain('Near Brisbane, AU');
    expect(container!.querySelector('[data-testid="tv-warning"]')!.textContent).toBe(
      "This TV will be able to see all photos and videos in your personal space and shared family folders. It can't change or delete anything.",
    );
    // The name field starts as the device type.
    const name = container!.querySelector<HTMLInputElement>('input')!;
    expect(name.value).toBe('Apple TV');
  });

  it('Allow posts the code, the decision and the name the person typed', async () => {
    apiMock.mockResolvedValueOnce(LOOKUP).mockResolvedValueOnce({ ok: true });
    await mount('/tv?code=KDTR-9WMX');
    await type(container!.querySelector<HTMLInputElement>('input')!, '  Living room  ');
    await click('Allow');
    expect(apiMock).toHaveBeenLastCalledWith('/api/auth/tv/approve', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((apiMock.mock.calls[1][1] as { body: string }).body);
    expect(body).toEqual({ user_code: 'KDTR-9WMX', decision: 'allow', device_name: 'Living room' });
    expect(container!.textContent).toContain('Your TV is signed in');
    expect(container!.textContent).toContain('You can close this page.');
  });

  it('an emptied name falls back to the device type', async () => {
    apiMock.mockResolvedValueOnce(LOOKUP).mockResolvedValueOnce({ ok: true });
    await mount('/tv?code=KDTR-9WMX');
    await type(container!.querySelector<HTMLInputElement>('input')!, '   ');
    await click('Allow');
    expect(JSON.parse((apiMock.mock.calls[1][1] as { body: string }).body).device_name).toBe('Apple TV');
  });

  it('Cancel posts a deny and says the TV was not signed in', async () => {
    apiMock.mockResolvedValueOnce(LOOKUP).mockResolvedValueOnce({ ok: true });
    await mount('/tv?code=KDTR-9WMX');
    await click('Cancel');
    expect(JSON.parse((apiMock.mock.calls[1][1] as { body: string }).body)).toEqual({ user_code: 'KDTR-9WMX', decision: 'deny' });
    expect(container!.textContent).toContain('TV sign-in cancelled');
  });

  it('an expired or used code says so and offers nothing to approve', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(404, JSON.stringify({ ok: false, error: 'Not found' })));
    await mount('/tv?code=KDTR-9WMX');
    expect(container!.textContent).toContain('This code has expired or was already used. Get a new code on your TV.');
    expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'Allow')).toBe(false);
  });

  it('a code that expires between lookup and Allow shows the expired state', async () => {
    apiMock.mockResolvedValueOnce(LOOKUP).mockRejectedValueOnce(new ApiError(404, JSON.stringify({ ok: false, error: 'Not found' })));
    await mount('/tv?code=KDTR-9WMX');
    await click('Allow');
    expect(container!.textContent).toContain('This code has expired or was already used.');
  });

  it('a 409 (already allowed or cancelled elsewhere) is refused and does not claim success', async () => {
    apiMock.mockResolvedValueOnce(LOOKUP).mockRejectedValueOnce(new ApiError(409, JSON.stringify({ ok: false, error: 'Already decided' })));
    await mount('/tv?code=KDTR-9WMX');
    await click('Allow');
    expect(container!.textContent).toContain('This code was already approved or cancelled.');
    expect(container!.textContent).not.toContain('Your TV is signed in');
  });

  it('a signed-out visitor is remembered and sent to login', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(401, JSON.stringify({ ok: false, error: 'Not authenticated' })));
    await mount('/tv?code=KDTR-9WMX');
    expect(sessionStorage.getItem('dosya.postAuthPath')).toBe('/tv?code=KDTR-9WMX');
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('a network failure offers Try again, which looks the code up again', async () => {
    apiMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(LOOKUP);
    await mount('/tv?code=KDTR-9WMX');
    expect(container!.querySelector('[role="alert"]')!.textContent).toBeTruthy();
    await click('Try again');
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(container!.textContent).toContain('Apple TV');
  });

  it('without a code it asks for one, and refuses a malformed code before any request', async () => {
    await mount('/tv');
    expect(container!.textContent).toContain('Enter the code shown on your TV.');
    const input = container!.querySelector<HTMLInputElement>('input')!;
    await type(input, 'abc');
    await act(async () => { container!.querySelector('form')!.requestSubmit(); });
    expect(container!.textContent).toContain('Enter the 8-character code from your TV.');
    expect(navigate).not.toHaveBeenCalled();
    expect(apiMock).not.toHaveBeenCalled();

    await type(input, 'kdtr9wmx');
    await act(async () => { container!.querySelector('form')!.requestSubmit(); });
    expect(navigate).toHaveBeenCalledWith('/tv?code=KDTR-9WMX');
  });

  it('a malformed code in the link shows the entry form with the error', async () => {
    await mount('/tv?code=KDTR-0WMX');
    expect(apiMock).not.toHaveBeenCalled();
    expect(container!.textContent).toContain('Enter the 8-character code from your TV.');
    expect(container!.querySelector<HTMLInputElement>('input')!.value).toBe('KDTR-0WMX');
  });
});
