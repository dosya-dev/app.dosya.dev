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
    apiMock.mockResolvedValue({ ok: true, links: [folderRow, fileRow] });
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
});
