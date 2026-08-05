import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IntegrationsSection } from './profile';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('IntegrationsSection', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  async function render() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <IntegrationsSection
          accounts={[
            { id: 'cca_1', provider: 'google', account_email: 'a@example.com', account_name: 'A', created_at: 0 },
          ]}
          providers={[{ id: 'google', label: 'Google Drive' }, { id: 'onedrive', label: 'OneDrive' }]}
          onChanged={() => {}}
        />,
      );
      await Promise.resolve();
    });
  }

  // This is exactly the trap called out in import-progress-card.tsx: two
  // label maps with different key spaces that agree everywhere except
  // Google. PROVIDER_LABELS is keyed by provider id ('google'); the wrong
  // map, IMPORT_SOURCE_LABELS, is keyed by files.import_source
  // ('google-drive') and returns undefined for 'google'. The lookup site in
  // profile.tsx has a `?? provider` fallback, so the wrong map doesn't blank
  // the heading - it renders the raw provider id ("google") instead of
  // "Google Drive", which is quieter than a blank and just as easy to miss
  // without a test pinned to the exact string.
  it('groups a connected google account under a "Google Drive" heading sourced from PROVIDER_LABELS', async () => {
    await render();

    const heading = container!.querySelector('[data-testid="provider-group-heading"]');
    expect(heading).not.toBeNull();
    expect(heading!.textContent).toBe('Google Drive');
    expect(container!.textContent).toContain('a@example.com');
  });

  it('(MINOR 16) renders each provider\'s own icon and a fallback (never another provider\'s mark) for an unmapped one', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <IntegrationsSection
          accounts={[
            { id: 'cca_1', provider: 'google', account_email: 'g@example.com', account_name: 'G', created_at: 0 },
            { id: 'cca_2', provider: 'onedrive', account_email: 'o@example.com', account_name: 'O', created_at: 0 },
            { id: 'cca_3', provider: 'dropbox', account_email: 'd@example.com', account_name: 'D', created_at: 0 },
          ]}
          providers={[{ id: 'google', label: 'Google Drive' }, { id: 'onedrive', label: 'OneDrive' }]}
          onChanged={() => {}}
        />,
      );
      await Promise.resolve();
    });

    const rows = [...container.querySelectorAll('p.text-xs.font-medium.truncate')];
    const rowFor = (email: string) =>
      rows.find((r) => r.textContent === email)!.closest('div.flex.items-center.justify-between')!;

    expect(rowFor('g@example.com').querySelector('img')?.getAttribute('src')).toBe('/google-color.svg');
    expect(rowFor('o@example.com').querySelector('img')?.getAttribute('src')).toBe('/onedrive-color.svg');
    // The unmapped provider must NOT silently render another provider's icon.
    expect(rowFor('d@example.com').querySelector('img')).toBeNull();
    expect(rowFor('d@example.com').querySelector('svg')).not.toBeNull();
  });

  it('renders one connect row per provider from the providers prop', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <IntegrationsSection
          accounts={[]}
          providers={[{ id: 'google', label: 'Google Drive' }, { id: 'onedrive', label: 'OneDrive' }]}
          onChanged={() => {}}
        />,
      );
      await Promise.resolve();
    });

    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links.some((h) => h?.endsWith('/api/cloud/connect/google'))).toBe(true);
    expect(links.some((h) => h?.endsWith('/api/cloud/connect/onedrive'))).toBe(true);
  });
});
