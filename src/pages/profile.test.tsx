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
});
