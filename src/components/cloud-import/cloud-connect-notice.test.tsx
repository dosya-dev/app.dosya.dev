import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { CloudConnectNotice } from './cloud-connect-notice';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(initialEntry: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(MemoryRouter, { initialEntries: [initialEntry] }, createElement(CloudConnectNotice)),
    );
    await Promise.resolve();
  });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('CloudConnectNotice', () => {
  it('renders nothing without result params', async () => {
    await render('/integrations/dropbox');
    expect(container!.querySelector('[data-testid="cloud-connect-notice"]')).toBeNull();
  });

  it('shows the denied copy for cloud_error=denied and keeps showing it after cleaning the URL', async () => {
    await render('/integrations/dropbox?cloud_error=denied');
    const notice = container!.querySelector('[data-testid="cloud-connect-notice"]');
    expect(notice?.textContent).toContain('Connection cancelled');
  });

  it('falls back to a generic message for an unknown error code', async () => {
    await render('/integrations/dropbox?cloud_error=mystery');
    expect(container!.querySelector('[data-testid="cloud-connect-notice"]')?.textContent)
      .toBe('Connection failed. Please try again.');
  });

  it('renders no banner on success (the connected-accounts card is the feedback)', async () => {
    await render('/integrations/dropbox?cloud_connected=1');
    expect(container!.querySelector('[data-testid="cloud-connect-notice"]')).toBeNull();
  });
});
