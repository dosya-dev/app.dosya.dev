import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

// The real module keeps ApiError and the error helpers; only `api` is faked.
const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { default: BrandingPage } = await import('./branding');
const { BrandingCard } = await import('../settings');
const { ApiError } = await import('@/api/client');
const { useWorkspace } = await import('@/stores/workspace');
const { formatExactDateTime } = await import('@/lib/date-format');

const PAID = {
  ok: true, enabled: true, can_edit: true, revoked: false, is_owner: true,
  branding: {
    brand_name: 'Kaya Studio', logo_url: null as string | null, brand_color: '#B4472E',
    share_handle: null as string | null, handle_set_at: null as number | null,
    apply_share: true, apply_email: true, hide_save_cta: true,
  },
};

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue(PAID);
  useWorkspace.setState({ activeId: 'ws1' });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

async function mount(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<MemoryRouter>{node}</MemoryRouter>); });
  await flush();
}
const page = () => mount(<BrandingPage />);

const q = <T extends Element>(sel: string) => container!.querySelector<T>(sel);
const byValue = (v: string) => [...container!.querySelectorAll('input')].find((i) => i.value === v) ?? null;
const text = () => container!.textContent ?? '';
const button = (re: RegExp) => [...container!.querySelectorAll('button')].find((b) => re.test(b.textContent ?? '')) ?? null;
const countText = (t: string) => [...container!.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.textContent === t).length;
const bodyButton = (re: RegExp) => [...document.body.querySelectorAll('button')].find((b) => re.test(b.textContent ?? '')) ?? null;

async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); await flush(); };
const putCalls = () => apiMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');

describe('branding page', () => {
  it('shows the stored brand', async () => {
    await page();
    expect(byValue('Kaya Studio')).toBeTruthy();
    expect(byValue('#B4472E')).toBeTruthy();
  });

  it('offers the handle field to the owner when unclaimed', async () => {
    await page();
    expect(q('input#share-handle')).toBeTruthy();
    expect(q('label[for="share-handle"]')?.textContent).toMatch(/share handle/i);
  });

  it('hides the handle field entirely from a non-owner', async () => {
    apiMock.mockResolvedValue({ ...PAID, is_owner: false });
    await page();
    expect(byValue('Kaya Studio')).toBeTruthy();
    expect(q('input#share-handle')).toBeNull();
    expect(text()).not.toMatch(/share handle/i);
  });

  it('shows a claimed handle as permanent, not editable', async () => {
    apiMock.mockResolvedValue({ ...PAID, branding: { ...PAID.branding, share_handle: 'kayastudio', handle_set_at: 1_760_000_000 } });
    await page();
    expect(text()).toContain('@kayastudio');
    expect(text()).toMatch(/cannot be changed/i);
    expect(q('input#share-handle')).toBeNull();
    // The claim date, through the app's shared formatter (viewer's locale and zone).
    expect(text()).toContain(`Claimed ${formatExactDateTime(1_760_000_000)}`);
  });

  it('shows no claim date for a claimed handle the server sent without one', async () => {
    apiMock.mockResolvedValue({ ...PAID, branding: { ...PAID.branding, share_handle: 'kayastudio', handle_set_at: null } });
    await page();
    expect(text()).toContain('@kayastudio');
    expect(text()).not.toMatch(/claimed/i);
  });

  it('empties the form on a workspace switch and keeps Save away until the new GET lands', async () => {
    await page();
    expect(byValue('Kaya Studio')).toBeTruthy();

    let land!: (v: unknown) => void;
    apiMock.mockImplementation((path: string) => path === '/api/workspaces/ws2/branding'
      ? new Promise((resolve) => { land = resolve; })
      : Promise.resolve({ ok: true }));
    await act(async () => { useWorkspace.setState({ activeId: 'ws2' }); });
    await flush();

    // Workspace A's values are gone and there is nothing to click.
    expect(byValue('Kaya Studio')).toBeNull();
    expect(byValue('#B4472E')).toBeNull();
    expect(button(/save branding/i)).toBeNull();

    await act(async () => { land({ ...PAID, branding: { ...PAID.branding, brand_name: 'Acme', brand_color: null } }); });
    await flush();
    expect(byValue('Acme')).toBeTruthy();

    await click(button(/save branding/i));
    const puts = putCalls();
    expect(puts).toHaveLength(1);
    expect(puts[0][0]).toBe('/api/workspaces/ws2/branding');
    expect(JSON.parse((puts[0][1] as RequestInit).body as string)).toMatchObject({ brand_name: 'Acme', brand_color: null });
  });

  it('ignores a late answer for the workspace that was switched away from', async () => {
    const pending: Record<string, (v: unknown) => void> = {};
    apiMock.mockImplementation((path: string) => new Promise((resolve) => { pending[path] = resolve; }));
    await page();
    await act(async () => { useWorkspace.setState({ activeId: 'ws2' }); });
    await flush();

    await act(async () => { pending['/api/workspaces/ws2/branding']({ ...PAID, branding: { ...PAID.branding, brand_name: 'Acme' } }); });
    await flush();
    // Workspace A's GET answers last and must change nothing.
    await act(async () => { pending['/api/workspaces/ws1/branding'](PAID); });
    await flush();
    expect(byValue('Acme')).toBeTruthy();
    expect(byValue('Kaya Studio')).toBeNull();
  });

  it('refuses to save an invalid colour without calling the API', async () => {
    await page();
    await type(byValue('#B4472E')!, 'red');
    await click(button(/save branding/i));
    expect(text()).toMatch(/six-digit hex/i);
    expect(putCalls()).toHaveLength(0);
  });

  it('reflects the brand in the live preview as it is typed', async () => {
    await page();
    await type(byValue('Kaya Studio')!, 'Northbank');
    expect(countText('Northbank')).toBeGreaterThan(1);
  });

  it('goes read-only when revoked, and says why', async () => {
    apiMock.mockResolvedValue({ ...PAID, revoked: true, can_edit: false });
    await page();
    expect(text()).toMatch(/disabled/i);
    expect(button(/save branding/i)).toBeNull();
    expect(byValue('Kaya Studio')!.disabled).toBe(true);
  });

  it('points a lapsed workspace at billing while still showing its values', async () => {
    apiMock.mockResolvedValue({ ...PAID, enabled: false, can_edit: false });
    await page();
    expect(byValue('Kaya Studio')).toBeTruthy();
    const link = [...container!.querySelectorAll('a')].find((a) => /plans|upgrade/i.test(a.textContent ?? ''));
    expect(link?.getAttribute('href')).toBe('/billing');
  });

  it('names SVG in the upload hint', async () => {
    await page();
    expect(text()).toMatch(/SVG/);
  });
});

describe('saving', () => {
  it('sends the switches as real booleans and the trimmed values', async () => {
    await page();
    await type(byValue('Kaya Studio')!, '  Northbank  ');
    await click(q('button[aria-label="Brand email"]'));
    await click(button(/save branding/i));
    expect(putCalls()).toHaveLength(1);
    const [path, init] = putCalls()[0] as [string, RequestInit];
    expect(path).toBe('/api/workspaces/ws1/branding');
    expect(JSON.parse(init.body as string)).toEqual({
      brand_name: 'Northbank', brand_color: '#B4472E', apply_share: true, apply_email: false, hide_save_cta: true,
    });
  });

  it('shows the server refusal when it disagrees with the advisory check', async () => {
    apiMock.mockImplementation(async (_p: string, init?: RequestInit) => {
      if (init?.method === 'PUT') throw new ApiError(400, JSON.stringify({ error: 'A brand name cannot contain line breaks or control characters.' }));
      return PAID;
    });
    await page();
    await click(button(/save branding/i));
    expect(container!.querySelector('[role="alert"]')?.textContent).toMatch(/control characters/);
  });

  it('refuses a brand name over 48 characters in the form', async () => {
    await page();
    await type(byValue('Kaya Studio')!, 'x'.repeat(49));
    expect(text()).toMatch(/at most 48/);
    await click(button(/save branding/i));
    expect(putCalls()).toHaveLength(0);
  });

  it('labels each switch with the surface it governs and states the email rule', async () => {
    await page();
    expect(q('button[aria-label="Brand the share page"]')).toBeTruthy();
    expect(q('button[aria-label="Brand email"]')).toBeTruthy();
    expect(q('button[aria-label="Hide the Save to dosya button"]')).toBeTruthy();
    expect(text()).toContain('noreply@dosya.dev');
    expect(text()).toMatch(/subjects still say dosya\.dev/);
  });

  it('keeps the email preview off the brand colour', async () => {
    await page();
    const styled = [...container!.querySelectorAll<HTMLElement>('[style]')];
    expect(styled.length).toBeGreaterThan(0); // the share bar accent
    const email = [...container!.querySelectorAll('p')].find((p) => p.textContent === 'Email')!.nextElementSibling!;
    expect(email.querySelectorAll('[style]').length).toBe(0);
    expect(email.getAttribute('style')).toBeNull();
  });
});

describe('preview only shows what ships', () => {
  it('falls back to dosya defaults when the name is empty, whatever else is set', async () => {
    apiMock.mockResolvedValue({ ...PAID, branding: { ...PAID.branding, brand_name: null, logo_url: 'https://api.dosya.dev/api/brand/abc/logo' } });
    await page();
    expect(text()).toMatch(/brand name is required/i);
    expect(countText('dosya.dev')).toBeGreaterThanOrEqual(2);
    expect(container!.querySelectorAll('img[alt=""]')).toHaveLength(0);
    const share = [...container!.querySelectorAll('p')].find((p) => p.textContent === 'Share page')!.nextElementSibling as HTMLElement;
    expect(share.getAttribute('style')).not.toContain('B4472E');
    expect(share.getAttribute('style')).toContain('var(--brand)');
    expect(countText('Save to dosya')).toBeGreaterThanOrEqual(1);
  });

  it('states that hiding the CTA applies only while share branding is on', async () => {
    await page();
    expect(text()).toMatch(/only while branding the share page is on/i);
  });
});

describe('reset to dosya', () => {
  it('does not claim success when the logo could not be removed', async () => {
    apiMock.mockResolvedValue({ ...PAID, branding: { ...PAID.branding, logo_url: 'https://api.dosya.dev/api/brand/abc/logo' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 500 })));
    await page();
    await click(button(/reset to dosya/i));
    await click(bodyButton(/^Reset$/));
    const toasts = document.getElementById('toast-root')?.textContent ?? '';
    expect(toasts).toMatch(/Partly reset/);
    expect(toasts).not.toMatch(/name, colour and logo were cleared/);
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe('nope');
  });

  it('asks first, then clears name and colour (PUT nulls) and never touches the handle', async () => {
    apiMock.mockResolvedValue({ ...PAID, branding: { ...PAID.branding, share_handle: 'kayastudio', handle_set_at: 1 } });
    await page();
    await click(button(/reset to dosya/i));
    expect(putCalls()).toHaveLength(0);
    await click(bodyButton(/^Reset$/));
    expect(putCalls()).toHaveLength(1);
    const body = JSON.parse((putCalls()[0][1] as RequestInit).body as string);
    expect(body).toEqual({ brand_name: null, brand_color: null });
    expect(JSON.stringify(apiMock.mock.calls)).not.toContain('/handle');
    expect(text()).toContain('@kayastudio');
  });
});

describe('claiming a handle', () => {
  it('debounces the availability check and skips malformed input', async () => {
    vi.useFakeTimers();
    await page();
    const input = q<HTMLInputElement>('input#share-handle')!;
    const avail = () => apiMock.mock.calls.filter(([p]) => String(p).includes('/handle/available'));

    await type(input, 'Bad Name');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(avail()).toHaveLength(0);
    expect(text()).toMatch(/lowercase/i);

    apiMock.mockImplementation(async (p: string) => (String(p).includes('/handle/available') ? { ok: true, available: true } : PAID));
    for (const v of ['k', 'ka', 'kay', 'kaya', 'kayas']) await type(input, v);
    expect(avail()).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(avail()).toHaveLength(1);
    expect(String(avail()[0][0])).toContain('handle=kayas');
    expect(text()).toMatch(/available/i);
  });

  it('shows the claim date straight after a successful claim', async () => {
    apiMock.mockImplementation(async (p: string, init?: RequestInit) => {
      if (String(p).includes('/handle/available')) return { ok: true, available: true };
      if (init?.method === 'POST') return { ok: true, handle: 'kayastudio' };
      return PAID;
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_760_000_000 * 1000));
    await page();
    await type(q<HTMLInputElement>('input#share-handle')!, 'kayastudio');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await click(button(/claim handle/i));
    await click(bodyButton(/claim permanently/i));
    expect(text()).toContain('@kayastudio');
    expect(text()).toContain(`Claimed ${formatExactDateTime(1_760_000_001)}`);
  });

  it('confirms before claiming and shows the 409 refusal', async () => {
    apiMock.mockImplementation(async (p: string, init?: RequestInit) => {
      if (String(p).includes('/handle/available')) return { ok: true, available: true };
      if (init?.method === 'POST') throw new ApiError(409, JSON.stringify({ error: 'That handle is taken. Pick another.' }));
      return PAID;
    });
    vi.useFakeTimers();
    await page();
    await type(q<HTMLInputElement>('input#share-handle')!, 'kayastudio');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await click(button(/claim handle/i));
    expect(apiMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toBe(false);
    await click(bodyButton(/claim permanently/i));
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe('That handle is taken. Pick another.');
  });
});

describe('logo upload', () => {
  it('refuses an SVG by name without calling the server', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await page();
    const input = q<HTMLInputElement>('[data-testid="logo-input"]')!;
    const file = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container!.querySelector('[role="alert"]')?.textContent).toMatch(/SVG/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts a PNG as the form field "file" and shows the new logo', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true, logo_url: 'https://api.dosya.dev/api/brand/abc/logo' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await page();
    const input = q<HTMLInputElement>('[data-testid="logo-input"]')!;
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array(8)], 'logo.png', { type: 'image/png' })], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush();
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/workspaces/ws1/branding/logo');
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
    expect(q('img[alt="Your logo"]')?.getAttribute('src')).toBe('https://api.dosya.dev/api/brand/abc/logo');
  });
});

describe('BrandingCard', () => {
  it('links to the page when branding is on', async () => {
    await mount(<BrandingCard wsId="ws1" />);
    expect(q('a[href="/settings/branding"]')?.textContent).toBe('Configure');
  });

  it('says Starter and up and links to plans on a free workspace', async () => {
    apiMock.mockResolvedValue({ ...PAID, enabled: false, can_edit: false });
    await mount(<BrandingCard wsId="ws1" />);
    expect(text()).toContain('Starter and up');
    expect(q('a[href="/billing"]')?.textContent).toBe('See plans');
  });

  it('is read-only with a reason when the role cannot edit branding', async () => {
    apiMock.mockResolvedValue({ ...PAID, can_edit: false });
    await mount(<BrandingCard wsId="ws1" />);
    expect(text()).toContain('Your role cannot change branding.');
    expect(button(/configure/i)!.disabled).toBe(true);
    expect(q('a[href="/settings/branding"]')).toBeNull();
  });

  it('is disabled with the reason when branding was revoked', async () => {
    apiMock.mockResolvedValue({ ...PAID, revoked: true, can_edit: false });
    await mount(<BrandingCard wsId="ws1" />);
    expect(text()).toMatch(/disabled for this workspace/);
    expect(button(/configure/i)!.disabled).toBe(true);
    expect(q('a[href="/settings/branding"]')).toBeNull();
  });
});

describe('full-size view', () => {
  const dialog = () => document.body.querySelector<HTMLElement>('[data-slot="dialog-content"]');
  const replica = () => document.body.querySelector<HTMLElement>('[data-testid="share-preview"]');
  const inDialog = (re: RegExp) => [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => re.test(b.textContent?.trim() ?? '')) ?? null;
  const previewCalls = () => apiMock.mock.calls.filter(([p]) => String(p).includes('/branding/preview-email'));
  const EMAIL = {
    ok: true,
    html: '<p>sample mail</p>',
    from: '"Kaya Studio" <noreply@dosya.dev>',
    subject: 'Firat shared a file with you: Q4-report.pdf',
  };
  const withPreview = (res: typeof PAID) => apiMock.mockImplementation(async (p: string) => (
    String(p).includes('/branding/preview-email') ? EMAIL : res));
  const openView = async () => { await click(button(/^View$/)); };

  it('opens from the Preview card', async () => {
    await page();
    expect(dialog()).toBeNull();
    await openView();
    expect(dialog()).toBeTruthy();
    expect(replica()).toBeTruthy();
  });

  it('shows the draft name on the share page and hides Save to dosya when asked', async () => {
    await page();
    await type(byValue('Kaya Studio')!, 'Northbank');
    await openView();
    const r = replica()!;
    expect(r.textContent).toContain('Northbank');
    expect(r.textContent).not.toContain('Kaya Studio');
    expect(r.textContent).toContain('Q4-report.pdf');
    expect(r.textContent).toContain('2.4 MB');
    expect(r.textContent).toContain('Shared by Firat');
    expect(r.textContent).toContain('dosya hosts this file and does not review shared content.');
    expect(r.textContent).not.toContain('Save to dosya');
    // The brand colour, through a style prop, on the Download button.
    const download = [...r.querySelectorAll<HTMLElement>('[data-role="download"]')][0];
    expect(download.style.backgroundColor).toBe('rgb(180, 71, 46)');
  });

  it('keeps Save to dosya when hide_save_cta is off', async () => {
    apiMock.mockResolvedValue({ ...PAID, branding: { ...PAID.branding, hide_save_cta: false } });
    await page();
    await openView();
    expect(replica()!.textContent).toContain('Save to dosya');
  });

  it('shows dosya with an empty name, whatever else is set', async () => {
    await page();
    await type(byValue('Kaya Studio')!, '');
    await openView();
    const r = replica()!;
    expect(r.textContent).toContain('dosya.dev');
    expect(r.textContent).toContain('Save to dosya');
    expect(r.innerHTML).not.toContain('180, 71, 46');
  });

  it('shows dosya when share branding is off: no name, colour or logo', async () => {
    apiMock.mockResolvedValue({ ...PAID, branding: { ...PAID.branding, apply_share: false, logo_url: 'https://api.dosya.dev/api/brand/abc/logo' } });
    await page();
    await openView();
    const r = replica()!;
    expect(r.textContent).not.toContain('Kaya Studio');
    expect(r.textContent).toContain('dosya.dev');
    expect(r.textContent).toContain('Save to dosya');
    // The stored colour (#B4472E) and logo are both still in the form, and neither ships.
    expect(r.innerHTML).not.toContain('180, 71, 46');
    expect(r.innerHTML).not.toMatch(/B4472E/i);
    expect(r.querySelector('img')).toBeNull();
    expect(r.innerHTML).not.toContain('/api/brand/abc/logo');
  });

  it('withholds the file behind the password gate and names the brand in the lede', async () => {
    await page();
    await openView();
    await click(dialog()!.querySelector('button[aria-label="Password protected"]'));
    const r = replica()!;
    expect(r.textContent).not.toContain('Q4-report.pdf');
    expect(r.textContent).not.toContain('2.4 MB');
    expect(r.textContent).not.toContain('Shared by Firat');
    expect(r.textContent).toContain('Kaya Studio');
    expect(r.textContent).toContain('Enter the password Kaya Studio shared with you.');
  });

  it('uses the unbranded lede on an unbranded gate', async () => {
    await page();
    await type(byValue('Kaya Studio')!, '');
    await openView();
    await click(dialog()!.querySelector('button[aria-label="Password protected"]'));
    expect(replica()!.textContent).toContain('Enter the password the sender shared with you.');
  });

  it('renders the email from the endpoint, debounced and only while the Email tab is open', async () => {
    vi.useFakeTimers();
    withPreview(PAID);
    await page();
    await openView();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(previewCalls()).toHaveLength(0);

    await click(inDialog(/^Email$/));
    expect(previewCalls()).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(previewCalls()).toHaveLength(1);
    const [path, init] = previewCalls()[0] as [string, RequestInit];
    expect(path).toBe('/api/workspaces/ws1/branding/preview-email');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ brand_name: 'Kaya Studio', logo: 'none' });

    const frame = dialog()!.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe('<p>sample mail</p>');
    expect(dialog()!.textContent).toContain('"Kaya Studio" <noreply@dosya.dev>');
    expect(dialog()!.textContent).toContain('Firat shared a file with you: Q4-report.pdf');
  });

  it('asks again for the stored logo, and with the edited name, after a pause', async () => {
    vi.useFakeTimers();
    withPreview({ ...PAID, branding: { ...PAID.branding, logo_url: 'https://api.dosya.dev/api/brand/abc/logo' } });
    await page();
    await openView();
    await click(inDialog(/^Email$/));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(JSON.parse((previewCalls()[0][1] as RequestInit).body as string)).toEqual({ brand_name: 'Kaya Studio', logo: 'current' });

    await type(byValue('Kaya Studio')!, 'Northbank');
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(previewCalls()).toHaveLength(2);
    expect(JSON.parse((previewCalls()[1][1] as RequestInit).body as string)).toEqual({ brand_name: 'Northbank', logo: 'current' });
  });

  it('collapses edits made within the debounce window into one request', async () => {
    vi.useFakeTimers();
    withPreview(PAID);
    await page();
    await openView();
    await click(inDialog(/^Email$/));
    await type(byValue('Kaya Studio')!, 'North');
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await type(byValue('North')!, 'Northbank');
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(previewCalls()).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(previewCalls()).toHaveLength(1);
    expect(JSON.parse((previewCalls()[0][1] as RequestInit).body as string)).toEqual({ brand_name: 'Northbank', logo: 'none' });
  });

  it('asks for dosya\'s own email when email branding is off', async () => {
    vi.useFakeTimers();
    withPreview({ ...PAID, branding: { ...PAID.branding, apply_email: false } });
    await page();
    await openView();
    await click(inDialog(/^Email$/));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(JSON.parse((previewCalls()[0][1] as RequestInit).body as string)).toMatchObject({ brand_name: null });
  });

  it('shows the refusal inline when the preview fails', async () => {
    vi.useFakeTimers();
    apiMock.mockImplementation(async (p: string) => {
      if (String(p).includes('/branding/preview-email')) throw new ApiError(400, JSON.stringify({ error: 'A brand name can be at most 48 characters.' }));
      return PAID;
    });
    await page();
    await openView();
    await click(inDialog(/^Email$/));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('A brand name can be at most 48 characters.');
    expect(dialog()!.querySelector('iframe')).toBeNull();
  });
});
