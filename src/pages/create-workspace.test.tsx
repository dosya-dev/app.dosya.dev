import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { default: CreateWorkspacePage } = await import('./create-workspace');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const REGIONS = [
  { code: 'eu-west-1', city: 'Dublin', country: 'Ireland', continent: 'Europe' },
  { code: 'ap-southeast-2', city: 'Sydney', country: 'Australia', continent: 'Oceania' },
];

beforeEach(() => {
  localStorage.clear();
  apiMock.mockReset();
  apiMock.mockImplementation(async (url: string, opts?: { method?: string }) => {
    if (url === '/api/regions') return { ok: true, regions: REGIONS, suggested: 'eu-west-1' };
    if (url === '/api/workspaces' && opts?.method === 'POST') return { ok: true, workspace: { id: 'ws_new' } };
    if (url === '/api/workspaces') return { ok: true, workspaces: [] };
    return { ok: true };
  });
});

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
    root!.render(<MemoryRouter><CreateWorkspacePage /></MemoryRouter>);
  });
  // The mount effect awaits both requests before it drops the loading spinner.
  await flush();
}

const options = () => [...container!.querySelectorAll('[role="option"]')] as HTMLButtonElement[];
const submitBtn = () =>
  [...container!.querySelectorAll('button')].find((b) => b.textContent?.includes('Create workspace')) as HTMLButtonElement;

function typeName(name: string) {
  const input = container!.querySelector('input[placeholder^="e.g."]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  const form = container!.querySelector('form') as HTMLFormElement;
  act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await flush();
}

const postBody = () => {
  const call = apiMock.mock.calls.find(([url, o]) => url === '/api/workspaces' && (o as { method?: string })?.method === 'POST');
  return call ? JSON.parse((call[1] as { body: string }).body) : null;
};

// Creation is the ONLY moment a workspace's location is chosen, so this page
// has to ask for it - and has to send it.
describe('CreateWorkspacePage - location', () => {
  it('offers every location the server lists, preselecting the suggested one', async () => {
    await render();
    expect(container!.textContent).toContain('Location');
    expect(options()).toHaveLength(2);
    const selected = options().filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain('Dublin');
  });

  it('sends the suggested location as default_region', async () => {
    await render();
    typeName('Work');
    await submit();
    expect(postBody()).toMatchObject({ name: 'Work', default_region: 'eu-west-1' });
  });

  it('sends the location the user picked instead', async () => {
    await render();
    typeName('Work');
    const sydney = options().find((o) => o.textContent?.includes('Sydney'))!;
    act(() => { sydney.click(); });
    await submit();
    expect(postBody()).toMatchObject({ default_region: 'ap-southeast-2' });
  });

  // The suggestion is a guess about the caller's geography. If it names a
  // location the list does not contain, highlighting nothing is honest - and
  // the form stays shut until the user picks one for real.
  it('selects nothing when the suggestion is not one of the offered locations', async () => {
    apiMock.mockImplementation(async (url: string, opts?: { method?: string }) => {
      if (url === '/api/regions') return { ok: true, regions: REGIONS, suggested: 'mars-north-1' };
      if (url === '/api/workspaces' && opts?.method === 'POST') return { ok: true, workspace: { id: 'ws_new' } };
      if (url === '/api/workspaces') return { ok: true, workspaces: [] };
      return { ok: true };
    });
    await render();
    expect(options().some((o) => o.getAttribute('aria-selected') === 'true')).toBe(false);
    expect(submitBtn().disabled).toBe(true);

    // Picking one for real opens the form again.
    typeName('Work');
    act(() => { options()[1].click(); });
    expect(submitBtn().disabled).toBe(false);
    await submit();
    expect(postBody()).toMatchObject({ default_region: 'ap-southeast-2' });
  });
});

// A locations outage used to disable the Create button for the rest of the page
// load, with no message and no way back: the picker's only empty state said the
// user's search matched nothing, and the submit guard could never fire behind a
// disabled default button. Creating a workspace must survive it.
describe('CreateWorkspacePage - when the locations cannot be loaded', () => {
  function offline(failures = Infinity) {
    let seen = 0;
    apiMock.mockImplementation(async (url: string, opts?: { method?: string }) => {
      if (url === '/api/regions') {
        seen += 1;
        if (seen <= failures) throw new Error('offline');
        return { ok: true, regions: REGIONS, suggested: 'eu-west-1' };
      }
      if (url === '/api/workspaces' && opts?.method === 'POST') return { ok: true, workspace: { id: 'ws_new' } };
      if (url === '/api/workspaces') return { ok: true, workspaces: [] };
      return { ok: true };
    });
  }
  const retryBtn = () =>
    [...container!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Try again') as HTMLButtonElement;

  it('says what went wrong and offers a retry', async () => {
    offline();
    await render();
    expect(container!.textContent).toContain("Couldn't load the list of locations.");
    expect(retryBtn()).toBeTruthy();
  });

  it('still creates the workspace, leaving the location to the server', async () => {
    offline();
    await render();
    typeName('Work');
    expect(submitBtn().disabled).toBe(false);
    await submit();
    // Sent without a location: the server falls back to its own suggestion,
    // which beats a form that can never be submitted.
    expect(postBody()).toMatchObject({ name: 'Work' });
    expect(postBody()).not.toHaveProperty('default_region');
  });

  it('recovers when the retry succeeds', async () => {
    offline(1);
    await render();
    act(() => { retryBtn().click(); });
    await flush();
    expect(container!.textContent).not.toContain("Couldn't load the list of locations.");
    expect(options()).toHaveLength(2);
    typeName('Work');
    await submit();
    expect(postBody()).toMatchObject({ default_region: 'eu-west-1' });
  });

  // An empty list is the same dead end as a failed fetch - the picker names it,
  // and the form must not be sealed behind it either.
  it('is submittable when the server offers no locations at all', async () => {
    apiMock.mockImplementation(async (url: string, opts?: { method?: string }) => {
      if (url === '/api/regions') return { ok: true, regions: [], suggested: '' };
      if (url === '/api/workspaces' && opts?.method === 'POST') return { ok: true, workspace: { id: 'ws_new' } };
      if (url === '/api/workspaces') return { ok: true, workspaces: [] };
      return { ok: true };
    });
    await render();
    expect(container!.textContent).toContain('No locations available.');
    typeName('Work');
    expect(submitBtn().disabled).toBe(false);
    await submit();
    expect(postBody()).not.toHaveProperty('default_region');
  });
});
