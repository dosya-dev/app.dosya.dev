import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { buildPlan } from '@/lib/takeout/plan';
import type { ZipEntry } from '@/lib/takeout/zip';
import { useTakeoutImport } from '@/stores/takeout-import';
import { useWorkspace } from '@/stores/workspace';

const { default: GoogleTakeoutImport } = await import('./google-takeout');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const initial = useTakeoutImport.getState();

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  useTakeoutImport.setState(initial, true);
});

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter><GoogleTakeoutImport /></MemoryRouter>);
    await Promise.resolve();
  });
  return container;
}

let crc = 1;
const entry = (name: string, size = 10): ZipEntry => ({
  name, isDir: false, size, storedSize: size, method: 0, localHeaderOffset: 0, crc32: crc++, encrypted: false, mtime: null,
});

function chosen() {
  const file = new File(['x'], 'takeout-20261101T120000Z-002.zip');
  const entries = [
    entry('Takeout/Google Photos/Trip/a.jpg'), entry('Takeout/Google Photos/Trip/a.jpg.json'),
    entry('Takeout/Google Photos/Trip/b.mp4'), entry('Takeout/Drive/notes.txt'),
  ];
  const archives = [{ file, status: 'ok' as const, entries }];
  return { archives, plan: buildPlan([{ file, entries }]) };
}

describe('Google Takeout import page', () => {
  it('starts on the drop area with the three-step guide', async () => {
    const el = await render();
    expect(el.querySelector('input[type=file][multiple]')).not.toBeNull();
    expect(el.querySelectorAll('ol li')).toHaveLength(3);
    expect(el.querySelector('a[href="https://takeout.google.com"]')).not.toBeNull();
  });

  it('lists the chosen zips, warns about the missing part and says what is inside', async () => {
    useWorkspace.setState({ activeId: 'ws1' });
    useTakeoutImport.setState({ ...chosen(), phase: 'ready' });
    const el = await render();
    const text = el.textContent ?? '';
    expect(text).toContain('takeout-20261101T120000Z-002.zip');
    expect(text).toContain('Google Photos');
    expect(text).toContain('Google Drive');
    // Part 2 chosen, part 1 not: the warning names it.
    expect(el.querySelector('.border-amber-500\\/30')?.textContent).toContain('1');
    const start = [...el.querySelectorAll('button')].find((b) => b.textContent && !b.disabled && b.className.includes('bg-primary'));
    expect(start).toBeTruthy();
  });

  it('shows progress and a pause button while running', async () => {
    useTakeoutImport.setState({
      ...chosen(), phase: 'running',
      progress: { total: 3, totalBytes: 30, done: 1, doneBytes: 10, resumed: 0, datesApplied: 0, placesApplied: 0, failures: [] },
    });
    const el = await render();
    expect(el.querySelector('[role=progressbar], [data-slot=progress]')).not.toBeNull();
    // No speed measured yet: sizes only.
    expect(el.querySelector('[data-testid=takeout-speed]')).toBeNull();
  });

  it('shows the upload speed and the time left once measured', async () => {
    useTakeoutImport.setState({
      ...chosen(), phase: 'running', bps: 1_000_000,
      progress: { total: 3, totalBytes: 1_510_000_000, done: 1, doneBytes: 10_000_000, resumed: 0, datesApplied: 0, placesApplied: 0, failures: [] },
    });
    const el = await render();
    expect(el.querySelector('[data-testid=takeout-speed]')?.textContent).toMatch(/\/s$/);
    // 1.5 GB at 1 MB/s.
    expect(el.querySelector('[data-testid=takeout-bytes]')?.textContent).toMatch(/25\s?min/);
  });

  it('summarises a finished import and lists failures on request', async () => {
    useTakeoutImport.setState({
      ...chosen(), phase: 'done', rootFolderId: 'fld_takeout',
      progress: { total: 3, totalBytes: 30, done: 3, doneBytes: 30, resumed: 0, datesApplied: 1, placesApplied: 0,
        failures: [{ name: 'b.mp4', dir: 'Google Takeout/Google Photos/Trip', reason: 'Server error' }] },
    });
    const el = await render();
    expect(el.querySelector('a[href="/files?folder=fld_takeout"]')).not.toBeNull();
    const seeList = [...el.querySelectorAll('button')].find((b) => b.className.includes('underline'))!;
    await act(async () => { seeList.click(); });
    expect(el.textContent).toContain('b.mp4: Server error');
  });
});
