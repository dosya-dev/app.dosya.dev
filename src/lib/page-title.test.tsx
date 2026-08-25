import { describe, it, expect, afterEach, beforeAll, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { formatUploadTitle, RouteTitle, useDocumentTitle } from './page-title';
import { useUploads } from '@/stores/uploads';
import type { UploadItem } from '@/lib/upload-types';
import type { UploadSummary } from '@/stores/uploads';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function summary(over: Partial<UploadSummary>): UploadSummary {
  return {
    total: 0, active: 0, done: 0, failed: 0, interrupted: 0, overallPct: 0,
    anyActive: false, activeUploadedBytes: 0, activeTotalBytes: 0, activeSpeedBps: 0,
    ...over,
  };
}

function item(over: Partial<UploadItem>): UploadItem {
  return {
    id: 'a', session_id: null, fileName: 'f', fileSize: 100, mimeType: 't',
    workspace_id: 'ws', folder_id: null, region: 'r', status: 'queued',
    progress: 0, bytesUploaded: 0, part_size: null, total_parts: null,
    uploaded_parts: [], ...over,
  };
}

describe('formatUploadTitle', () => {
  it('returns null when no upload is active', () => {
    expect(formatUploadTitle(summary({ anyActive: false }))).toBeNull();
  });

  it('formats a single active file, singular', () => {
    expect(formatUploadTitle(summary({ anyActive: true, active: 1, overallPct: 42 })))
      .toBe('42% · Uploading 1 file · dosya.dev');
  });

  it('formats multiple active files, plural', () => {
    expect(formatUploadTitle(summary({ anyActive: true, active: 3, overallPct: 73 })))
      .toBe('73% · Uploading 3 files · dosya.dev');
  });

  it('formats 0% at the very start of an upload', () => {
    expect(formatUploadTitle(summary({ anyActive: true, active: 2, overallPct: 0 })))
      .toBe('0% · Uploading 2 files · dosya.dev');
  });
});

describe('RouteTitle upload override (integration)', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    useUploads.setState({ items: [] });
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
  });

  async function mount(path: string) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={[path]}>
          <RouteTitle />
        </MemoryRouter>,
      );
    });
  }

  it('overrides the tab title while an upload is active, then reverts', async () => {
    await mount('/settings');
    expect(document.title).toBe('Settings · dosya.dev');

    await act(async () => {
      useUploads.getState().addItems([
        item({ id: '1', status: 'uploading', fileSize: 100, bytesUploaded: 50 }),
      ]);
    });
    expect(document.title).toBe('50% · Uploading 1 file · dosya.dev');

    await act(async () => {
      useUploads.getState().patchItem('1', { status: 'complete', bytesUploaded: 100 });
    });
    expect(document.title).toBe('Settings · dosya.dev');
  });

  it('overrides even on self-managed routes RouteTitle otherwise leaves alone', async () => {
    await mount('/editor/abc');
    await act(async () => {
      useUploads.getState().addItems([
        item({ id: '1', status: 'uploading', fileSize: 100, bytesUploaded: 25 }),
      ]);
    });
    expect(document.title).toBe('25% · Uploading 1 file · dosya.dev');
  });
});

describe('useDocumentTitle upload override (integration)', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    useUploads.setState({ items: [] });
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
  });

  function Host({ title }: { title: string | null }) {
    useDocumentTitle(title);
    return null;
  }

  async function mount(title: string | null) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<Host title={title} />);
    });
  }

  it('overrides a data-driven title while an upload is active, then reverts', async () => {
    await mount('My Folder');
    expect(document.title).toBe('My Folder · dosya.dev');

    await act(async () => {
      useUploads.getState().addItems([
        item({ id: '1', status: 'uploading', fileSize: 100, bytesUploaded: 10 }),
      ]);
    });
    expect(document.title).toBe('10% · Uploading 1 file · dosya.dev');

    await act(async () => {
      useUploads.getState().patchItem('1', { status: 'complete', bytesUploaded: 100 });
    });
    expect(document.title).toBe('My Folder · dosya.dev');
  });
});
