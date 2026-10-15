import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const { default: DesktopSetup } = await import('./desktop');

const MANIFEST = {
  ok: true,
  version: '3.1.1',
  builds: {
    mac: { fileName: 'dosya-3.1.1-universal.dmg', size: 251575955 },
    windows: { fileName: 'dosya-3.1.1-x64.exe', size: 120677912 },
    linux: {
      fileName: 'dosya-3.1.1-x86_64.AppImage',
      size: 162244723,
      deb: { fileName: 'dosya-3.1.1-amd64.deb', size: 110000000 },
    },
  },
  channels: { snap: { channel: 'candidate', version: '3.1.1' } },
};

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
  vi.unstubAllGlobals();
});

async function render({ ua, manifest = MANIFEST as unknown }: { ua: string; manifest?: unknown }) {
  vi.stubGlobal('navigator', { ...navigator, userAgent: ua });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      manifest === null
        ? { ok: false, json: async () => ({}) }
        : { ok: true, json: async () => manifest },
    ),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter><DesktopSetup /></MemoryRouter>);
  });
  // Settle the manifest fetch.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return container!.textContent ?? '';
}

const hrefs = () => [...container!.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');

const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15';
const WIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const LINUX_UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

describe('DesktopSetup leads with the build you can run', () => {
  it('offers the mac build, its architecture and the App Store, to a Mac', async () => {
    const text = await render({ ua: MAC_UA });
    expect(text).toContain('Download for macOS');
    expect(text).toContain('Apple Silicon and Intel');
    expect(text).toContain('drag');
    expect(hrefs().some((h) => h.includes('platform=mac'))).toBe(true);
    expect(hrefs().some((h) => h.includes('apps.apple.com'))).toBe(true);
  });

  /**
   * Apple's guidelines cover the badge artwork, its proportions and its clear
   * space, so it ships unmodified at its intrinsic 156x40 with height driving
   * the size. Asserted because "make it fit" is how a badge gets stretched.
   */
  it('uses Apple’s own badge, unmodified, beside the download button', async () => {
    await render({ ua: MAC_UA });
    const badge = container!.querySelector('img[src="/badges/mac-appstore.svg"]');
    expect(badge, 'no Mac App Store badge').not.toBeNull();
    expect(badge!.getAttribute('width')).toBe('156');
    expect(badge!.getAttribute('height')).toBe('40');
    expect(badge!.getAttribute('alt')).toBe('Download on the Mac App Store');
    expect(badge!.className).toContain('w-auto');

    // Beside the download, not in a later step.
    const button = [...container!.querySelectorAll('a')]
      .find((a) => (a.getAttribute('href') ?? '').includes('platform=mac'));
    expect(button!.parentElement).toBe(badge!.closest('a')!.parentElement);
  });

  /**
   * With the badge in step 1 there is no store step on macOS, so the numbers
   * have to close up. A page that reads 1, 2, 4 looks broken.
   */
  it('numbers the steps contiguously on every platform', async () => {
    for (const ua of [MAC_UA, WIN_UA, LINUX_UA]) {
      await render({ ua });
      const numbers = [...container!.querySelectorAll('section')]
        .map((s) => s.textContent?.trim().match(/^(\d+)/)?.[1])
        .filter(Boolean)
        .map(Number);
      expect(numbers, ua.slice(0, 24)).toEqual(numbers.map((_, i) => i + 1));
      if (root) act(() => root!.unmount());
      container?.remove();
      root = null;
      container = null;
    }
  });

  it('offers the exe, the SmartScreen warning and the Microsoft Store, to Windows', async () => {
    const text = await render({ ua: WIN_UA });
    expect(text).toContain('Download for Windows');
    expect(text).toContain('SmartScreen');
    expect(hrefs().some((h) => h.includes('platform=windows'))).toBe(true);
    // <ms-store-badge> only renders once its script defines the element, and
    // that script is never loaded here, so the component's static fallback is
    // what must be present. Either route reaches the listing.
    const msBadge = container!.querySelector('ms-store-badge, img[src="/badges/msstore.svg"]');
    expect(msBadge, 'no Microsoft Store badge').not.toBeNull();
  });

  it('offers the AppImage, chmod, the deb and the snap channel, to Linux', async () => {
    const text = await render({ ua: LINUX_UA });
    expect(text).toContain('Download for Linux');
    expect(text).toContain('chmod +x');
    expect(text).toContain('.deb package');
    // Not a bare `snap install dosya`: it finds nothing while on candidate.
    expect(text).toContain('sudo snap install dosya --candidate');
    expect(hrefs().some((h) => h.includes('format=deb'))).toBe(true);
    expect(hrefs().some((h) => h.includes('snapcraft.io'))).toBe(true);
  });

  /**
   * Canonical's artwork is named after its own colour, so the black badge is
   * for the light theme and the white one for dark. Both ship and CSS picks
   * one, which is how the marketing twin avoids a flash and a script. The
   * hidden/dark:block pairing is the whole mechanism, so it is asserted.
   */
  it('ships both Snap colourways and lets CSS choose', async () => {
    await render({ ua: LINUX_UA });
    const black = container!.querySelector('img[src="/badges/snap-store-black.svg"]');
    const white = container!.querySelector('img[src="/badges/snap-store-white.svg"]');
    expect(black, 'no black Snap badge').not.toBeNull();
    expect(white, 'no white Snap badge').not.toBeNull();
    expect(black!.className).toContain('dark:hidden');
    expect(white!.className).toContain('dark:block');
    for (const img of [black!, white!]) {
      expect(img.getAttribute('width')).toBe('182');
      expect(img.getAttribute('height')).toBe('56');
      expect(img.className).toContain('w-auto');
    }
  });

  /**
   * The badge is a claim that the listing has something on it. Without a
   * snap in the manifest there is nothing published, so neither the badge
   * nor the command may appear.
   */
  it('shows no Snap badge when no snap has been published', async () => {
    const noSnap = { ...MANIFEST, channels: {} };
    const text = await render({ ua: LINUX_UA, manifest: noSnap });
    expect(text).toContain('Download for Linux');
    expect(container!.querySelector('img[src^="/badges/snap-store"]')).toBeNull();
    expect(text).not.toContain('snap install');
  });

  it('shows the version and size the manifest reported', async () => {
    const text = await render({ ua: MAC_UA });
    expect(text).toContain('v3.1.1');
    expect(text).toContain('252 MB');
  });
});

describe('the cases a three-button page got wrong', () => {
  /**
   * An Android UA contains "linux". Detection must not hand a phone a
   * 162 MB AppImage; it says so instead, and points at the mobile apps.
   */
  it('never steers a phone at a desktop binary', async () => {
    const text = await render({ ua: ANDROID_UA });
    expect(text).toContain('This one is for a computer');
    expect(text).not.toContain('Download for Linux');
    expect(hrefs().some((h) => h.includes('dosya.dev/mobile'))).toBe(true);
  });

  it('falls back to all three when it cannot tell', async () => {
    const text = await render({ ua: 'something unrecognisable' });
    expect(text).toContain('Windows');
    expect(text).toContain('macOS');
    expect(text).toContain('Linux');
    expect(text).not.toContain('This one is for a computer');
  });

  /**
   * Detection is a guess. Someone downloading for another machine must be
   * able to override it, and the page then follows the choice.
   */
  it('lets the reader pick another platform', async () => {
    await render({ ua: MAC_UA });
    const other = [...container!.querySelectorAll('button')].find((b) => b.textContent === 'Windows');
    expect(other, 'no control to switch platform').toBeDefined();
    await act(async () => { other!.click(); });
    expect(container!.textContent).toContain('Download for Windows');
  });

  /**
   * The manifest is a second request. The page must still be usable when it
   * fails, because the download links do not depend on it.
   */
  it('still offers a working download when the manifest call fails', async () => {
    const text = await render({ ua: MAC_UA, manifest: null });
    expect(text).toContain('Download for macOS');
    expect(hrefs().some((h) => h.includes('platform=mac'))).toBe(true);
    expect(text).not.toContain('v3.1.1');
    expect(text).not.toContain('252 MB');
  });

  /**
   * Checked on Linux, where a snap block exists to suppress: with no manifest
   * there is no channel to name, and `snap install dosya` without one finds
   * nothing. The page must not print a command it cannot stand behind, and
   * must not offer a .deb the manifest never mentioned.
   */
  it('claims no snap command and no deb without a manifest to back them', async () => {
    const text = await render({ ua: LINUX_UA, manifest: null });
    expect(text).toContain('Download for Linux');
    expect(text).toContain('chmod +x');
    expect(text).not.toContain('snap install');
    expect(text).not.toContain('.deb package');
    expect(hrefs().some((h) => h.includes('format=deb'))).toBe(false);
  });
});
