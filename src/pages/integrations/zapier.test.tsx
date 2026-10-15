import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ZAPIER_INVITE_URL } from '@/lib/integrations';

const { default: ZapierSetup } = await import('./zapier');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

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
    root!.render(<MemoryRouter><ZapierSetup /></MemoryRouter>);
    await Promise.resolve();
  });
}

function hrefs(): string[] {
  return [...container!.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
}

describe('ZapierSetup', () => {
  /**
   * The page is reached by clicking the card, and the card is the only thing
   * that tells a reader the integration exists. A page that threw on render
   * would leave the card leading to the error boundary, so render it.
   */
  it('renders the walkthrough', async () => {
    await render();
    expect(container!.textContent).toContain('Add dosya to your Zapier account');
    expect(container!.textContent).toContain('Connect your account');
    expect(container!.textContent).toContain('Build a Zap');
  });

  /**
   * The app is private on Zapier, so this link is the only way in. Searching
   * the directory finds nothing, and the page says as much; if the link ever
   * stops being rendered the page becomes a dead end.
   */
  it('offers the invite link, because the app is not in the directory', async () => {
    await render();
    expect(hrefs()).toContain(ZAPIER_INVITE_URL);
    expect(container!.textContent).toContain('not in Zapier');
  });

  it('opens external links in a new tab without leaking the referrer', async () => {
    await render();
    for (const a of container!.querySelectorAll('a[href^="http"]')) {
      expect(a.getAttribute('target'), a.getAttribute('href') ?? '').toBe('_blank');
      expect(a.getAttribute('rel'), a.getAttribute('href') ?? '').toContain('noreferrer');
    }
  });

  /**
   * ApiKeyCallout is where this page sends people for a key. /settings/api-keys
   * is not a route in this app and lands on the catch-all 404, which is what
   * apps/zapier still tells users to visit.
   */
  it('points at the API keys route that exists', async () => {
    await render();
    expect(hrefs()).toContain('/profile/api');
    expect(hrefs().some((h) => h.includes('/settings/api-keys'))).toBe(false);
  });
});
