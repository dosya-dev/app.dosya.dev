import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { default: SharedPage } = await import('./shared');
const { useWorkspace } = await import('@/stores/workspace');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

// GET /api/shares nulls file_id/file_name/size_bytes/region for folder shares
// (is_folder: true) and resolves the real name into display_name instead.
// This is exactly the shape that crashed the page before the display_name
// switch (see 369cfecc): l.file_name.toLowerCase() threw on the folder row.
const folderRow = {
  link_id: 'link_folder', token: 'tok_folder', url: 'https://dosya.dev/s/tok_folder',
  expires_at: null, view_count: 3, download_count: 1,
  is_revoked: 0, shared_at: 1_700_000_000, created_by: 'user_1',
  file_id: null, file_name: null,
  folder_name: 'Vacation Photos', is_folder: true,
  display_name: 'Vacation Photos',
  size_bytes: null, extension: null, region: null, sharer_name: 'Jane Doe',
  status: 'active', is_mine: true,
  is_password_protected: 0, lock_mode: 'none', access_mode: 'public', recipient_count: 0,
};

const fileRow = {
  link_id: 'link_file', token: 'tok_file', url: 'https://dosya.dev/s/tok_file',
  expires_at: null, view_count: 5, download_count: 2,
  is_revoked: 0, shared_at: 1_700_000_000, created_by: 'user_1',
  file_id: 'file_1', file_name: 'report.pdf',
  folder_name: null, is_folder: false,
  display_name: 'report.pdf',
  size_bytes: 12345, extension: '.pdf', region: 'syd', sharer_name: 'Jane Doe',
  status: 'active', is_mine: true,
  is_password_protected: 0, lock_mode: 'none', access_mode: 'public', recipient_count: 0,
};

/** A private link somebody else sent to this account. */
const withMeRow = {
  link_id: 'link_wm', url: 'https://dosya.dev/s/tok_wm', display_name: 'brief.pdf',
  is_folder: false, is_bundle: false, size_bytes: 2048, extension: 'pdf',
  is_password_protected: 0, lock_mode: 'none',
  expires_at: null, revoked_at: null, status: 'active',
  shared_at: 1_700_000_000, invited_at: 1_700_000_000,
  verified_at: null, sender_name: 'Dana',
};

/** A link carrying every protection the endpoint can report at once. */
const protectedRow = {
  ...fileRow,
  link_id: 'link_protected', token: 'tok_protected', url: 'https://dosya.dev/s/tok_protected',
  file_name: 'payroll.xlsx', display_name: 'payroll.xlsx',
  is_password_protected: 1, lock_mode: 'view_only', access_mode: 'restricted', recipient_count: 2,
};

describe('SharedPage', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeAll(() => {
    useWorkspace.setState({ activeId: 'ws_1' });
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    apiMock.mockReset();
  });

  async function render() {
    apiMock.mockImplementation(async (path: string) =>
      String(path).includes('/with-me')
        ? { ok: true, links: [], email_verified: true }
        : { ok: true, links: [folderRow, fileRow] });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<MemoryRouter><SharedPage /></MemoryRouter>);
      await Promise.resolve();
    });
  }

  function typeSearch(value: string) {
    const input = container!.querySelector<HTMLInputElement>('input[placeholder="Filter by name or person..."]')!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('renders a folder share row using display_name, not the null file_name', async () => {
    await render();
    expect(container!.textContent).toContain('Vacation Photos');
    expect(container!.textContent).toContain('report.pdf');
  });

  it('does not throw when searching, and filters both rows by display_name', async () => {
    await render();

    // Would have thrown on l.file_name.toLowerCase() for the folder row
    // before the display_name fix.
    expect(() => typeSearch('vacation')).not.toThrow();
    expect(container!.textContent).toContain('Vacation Photos');
    expect(container!.textContent).not.toContain('report.pdf');

    typeSearch('report');
    expect(container!.textContent).toContain('report.pdf');
    expect(container!.textContent).not.toContain('Vacation Photos');

    typeSearch('nothing matches this');
    expect(container!.textContent).not.toContain('Vacation Photos');
    expect(container!.textContent).not.toContain('report.pdf');

    typeSearch('');
    expect(container!.textContent).toContain('Vacation Photos');
    expect(container!.textContent).toContain('report.pdf');
  });

  /**
   * /api/shares has returned is_password_protected, lock_mode, access_mode and
   * recipient_count since migration 0086, and this table rendered none of them
   * - so a password-protected, invite-only, view-only link was visually
   * identical to a bearer link anyone with the URL could open.
   */
  describe('protection badges', () => {
    async function renderWith(links: unknown[]) {
      apiMock.mockResolvedValue({ ok: true, links });
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(<MemoryRouter><SharedPage /></MemoryRouter>);
        await Promise.resolve();
      });
    }

    it('marks a password-protected link', async () => {
      await renderWith([protectedRow]);
      expect(container!.querySelector('[aria-label="Password required"]')).toBeTruthy();
    });

    it('marks a view-only link', async () => {
      await renderWith([protectedRow]);
      expect(container!.querySelector('[aria-label="View only, no downloads"]')).toBeTruthy();
    });

    it('shows how many people a restricted link is limited to', async () => {
      await renderWith([protectedRow]);
      const badge = container!.querySelector('[title*="invited"]');
      expect(badge).toBeTruthy();
      expect(badge!.textContent).toContain('2');
    });

    it('leaves an ordinary public link unmarked', async () => {
      await renderWith([fileRow]);
      expect(container!.querySelector('[aria-label="Password required"]')).toBeNull();
      expect(container!.querySelector('[aria-label="View only, no downloads"]')).toBeNull();
      expect(container!.querySelector('[title*="invited"]')).toBeNull();
    });
  });

  /**
   * The tab shipped rendered but inert: hardcoded `value="by-me"`, a literal
   * `-` badge and no handler, because /api/shares cannot express "pointed at
   * me". GET /api/shares/with-me is the query behind it.
   */
  describe('shared with me', () => {
    async function renderTabs(withMe: { links: unknown[]; email_verified?: boolean }) {
      apiMock.mockImplementation(async (path: string) =>
        String(path).includes('/with-me')
          ? { ok: true, email_verified: true, ...withMe }
          : { ok: true, links: [fileRow] });
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(<MemoryRouter><SharedPage /></MemoryRouter>);
        await Promise.resolve();
      });
      await act(async () => { await Promise.resolve(); });
    }

    function clickWithMe() {
      const tab = [...container!.querySelectorAll('button')]
        .find((b) => b.textContent?.includes('With me'))!;
      expect(tab, 'With me tab').toBeTruthy();
      act(() => { tab.click(); });
    }

    it('asks the endpoint for links sent to this account', async () => {
      await renderTabs({ links: [] });
      expect(apiMock.mock.calls.some(([p]) => String(p).includes('/api/shares/with-me'))).toBe(true);
    });

    it('counts them in the tab instead of a literal dash', async () => {
      await renderTabs({ links: [withMeRow] });
      const tab = [...container!.querySelectorAll('button')].find((b) => b.textContent?.includes('With me'))!;
      expect(tab.textContent).toContain('1');
      expect(tab.textContent).not.toContain('-');
    });

    it('switches to the list when the tab is clicked', async () => {
      await renderTabs({ links: [withMeRow] });
      expect(container!.textContent).toContain('report.pdf');
      clickWithMe();
      expect(container!.textContent).toContain('brief.pdf');
      expect(container!.textContent).toContain('Dana');
      // The by-me table is gone, not merged in behind it.
      expect(container!.textContent).not.toContain('report.pdf');
    });

    it('says whether YOU have opened it, and never the sender\'s counters', async () => {
      await renderTabs({ links: [withMeRow] });
      clickWithMe();
      expect(container!.textContent).toContain('Not opened yet');
      expect(container!.textContent).not.toContain('download');
    });

    it('explains an unverified address rather than showing an empty list', async () => {
      await renderTabs({ links: [], email_verified: false });
      clickWithMe();
      expect(container!.textContent).toContain('Verify your email');
    });

    it('has its own empty state', async () => {
      await renderTabs({ links: [] });
      clickWithMe();
      expect(container!.textContent).toContain('Nothing shared with you');
    });

    it('survives the endpoint failing, rather than breaking the page', async () => {
      apiMock.mockImplementation(async (path: string) => {
        if (String(path).includes('/with-me')) throw new Error('boom');
        return { ok: true, links: [fileRow] };
      });
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(<MemoryRouter><SharedPage /></MemoryRouter>);
        await Promise.resolve();
      });
      await act(async () => { await Promise.resolve(); });
      expect(container!.textContent).toContain('report.pdf');
    });
  });
});
