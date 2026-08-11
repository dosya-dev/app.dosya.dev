import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FileItem } from '@/lib/file-types';

// The peaks path needs a real OfflineAudioContext and a worker; neither exists
// under jsdom, and neither is what these assertions are about.
vi.mock('./use-peaks', () => ({
  usePeaks: () => ({ peaks: new Float32Array(900).fill(0.5), state: 'ready' }),
}));

const tagsRef: { value: { title?: string; artist?: string; album?: string; bitrateKbps?: number } } = { value: {} };
vi.mock('./use-audio-tags', () => ({
  useAudioTags: () => ({ tags: tagsRef.value, artworkUrl: null }),
}));

const { AudioPlayer } = await import('./audio-player');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom's HTMLMediaElement throws "Not implemented" on play/pause.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn(async () => {}) });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => { tagsRef.value = {}; });

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

const file = {
  id: 'f1',
  name: '03 Midnight Ferry.mp3',
  size_bytes: 10066329,
  mime_type: 'audio/mpeg',
  folder_id: null,
} as unknown as FileItem;

const sibling = (id: string, name: string) =>
  ({ id, name, size_bytes: 2_000_000, mime_type: 'audio/mpeg', folder_id: null } as unknown as FileItem);

function renderPlayer(over: { files?: FileItem[]; current?: FileItem; onNavigate?: (f: FileItem) => void } = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(AudioPlayer, {
        file: over.current ?? file,
        files: over.files ?? [file],
        rawUrl: 'https://api.example.com/api/files/f1/raw',
        downloadUrl: 'https://api.example.com/api/files/f1/download',
        version: undefined,
        onNavigate: over.onNavigate ?? (() => {}),
      }),
    );
  });
  return container!;
}

const text = (el: HTMLElement) => el.textContent ?? '';

describe('AudioPlayer', () => {
  it('falls back to the filename without its extension when the file carries no title', () => {
    const el = renderPlayer();
    expect(el.querySelector('h2')?.textContent).toBe('03 Midnight Ferry');
    expect(text(el)).not.toContain('03 Midnight Ferry.mp3');
  });

  it('prefers the embedded title over the filename', () => {
    tagsRef.value = { title: 'Midnight Ferry', artist: 'Neon Aviary', album: 'Signal Hills' };
    const el = renderPlayer();
    expect(el.querySelector('h2')?.textContent).toBe('Midnight Ferry');
    expect(text(el)).toContain('Neon Aviary');
    expect(text(el)).toContain('Signal Hills');
  });

  it('renders a seekable slider carrying the position in the accessible name', () => {
    const el = renderPlayer();
    const slider = el.querySelector('[role="slider"]');
    expect(slider).not.toBeNull();
    expect(slider!.getAttribute('aria-label')).toBe('Seek');
    expect(slider!.getAttribute('aria-valuenow')).toBe('0');
    expect(slider!.getAttribute('aria-valuetext')).toBe('0:00 of 0:00');
  });

  it('labels the primary control by what it does, not by its icon', () => {
    const el = renderPlayer();
    expect(el.querySelector('[aria-label="Play"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Pause"]')).toBeNull();
  });

  it('shows the format and size so the file is identifiable without tags', () => {
    const el = renderPlayer();
    expect(text(el)).toContain('MP3');
    expect(text(el)).toContain('9.6 MB');
  });

  it('shows a bitrate chip only when the file actually reported one', () => {
    const plain = renderPlayer();
    expect(text(plain)).not.toContain('kbps');
    act(() => root!.unmount());
    container!.remove();

    tagsRef.value = { bitrateKbps: 320 };
    const tagged = renderPlayer();
    expect(text(tagged)).toContain('320 kbps');
  });

  it('renders no artwork image when the file has none, rather than a broken one', () => {
    const el = renderPlayer();
    expect(el.querySelector('img')).toBeNull();
  });
});

describe('AudioPlayer queue', () => {
  const b = sibling('f2', '04 Harbour Static.mp3');
  const doc = sibling('f3', 'liner notes.txt');
  const siblings = [file, b, doc];

  it('shows no queue for a lone track - a one-row list is noise', () => {
    const el = renderPlayer();
    expect(el.querySelector('button[data-track]')).toBeNull();
  });

  it('builds the queue from the audio siblings only, skipping other file types', () => {
    const el = renderPlayer({ files: siblings });
    const rows = el.querySelectorAll('button[data-track]');
    expect(rows).toHaveLength(2);
    expect(el.textContent).not.toContain('liner notes');
  });

  it('navigates to the picked track', () => {
    const onNavigate = vi.fn();
    const el = renderPlayer({ files: siblings, onNavigate });
    act(() => { (el.querySelectorAll<HTMLButtonElement>('button[data-track]')[1]).click(); });
    expect(onNavigate).toHaveBeenCalledWith(b);
  });

  it('disables next on the last track and previous on the first', () => {
    const first = renderPlayer({ files: siblings });
    expect(first.querySelector<HTMLButtonElement>('[aria-label="Previous track"]')!.disabled).toBe(true);
    expect(first.querySelector<HTMLButtonElement>('[aria-label="Next track"]')!.disabled).toBe(false);
    act(() => root!.unmount());
    container!.remove();

    const last = renderPlayer({ files: siblings, current: b });
    expect(last.querySelector<HTMLButtonElement>('[aria-label="Next track"]')!.disabled).toBe(true);
    expect(last.querySelector<HTMLButtonElement>('[aria-label="Previous track"]')!.disabled).toBe(false);
  });

  it('moves between tracks on Shift + arrow', () => {
    const onNavigate = vi.fn();
    renderPlayer({ files: siblings, onNavigate });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith(b);
  });

  it('seeks rather than changing track on a bare arrow', () => {
    const onNavigate = vi.fn();
    renderPlayer({ files: siblings, onNavigate });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('toggles playback on Space', () => {
    const el = renderPlayer({ files: siblings });
    expect(el.querySelector('[aria-label="Play"]')).not.toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); });
    expect(el.querySelector('[aria-label="Pause"]')).not.toBeNull();
  });
});
