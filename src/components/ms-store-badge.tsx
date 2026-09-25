/**
 * Microsoft's official "Get it from Microsoft" badge.
 *
 * The site-wide twin of src/components/MsStoreBadge.astro on dosya.dev - same
 * product id, same attributes, same 38px height as the App Store and Play
 * badges it stands beside. Read that file's header for what the web component
 * actually does on click and why `size="small"` rather than `large`; the notes
 * below are only what differs inside this SPA.
 *
 * THEME: Microsoft names each artwork after its own colour, not the background
 * it belongs on - theme="dark" is the #202020 badge for a LIGHT surface,
 * theme="light" is the #FDFDFD badge for a DARK one. The built-in theme="auto"
 * reads the OS preference once at construction, which is wrong for anyone whose
 * app theme differs from their OS and never reacts to the theme switcher, so
 * the attribute is driven from `html.dark` (set by public/theme-init.js) and
 * re-read whenever that class changes.
 *
 * WHY THE SCRIPT IS NOT IN index.html: every route in this app serves the same
 * shell, so a <script> tag there would pull 13KB from get.microsoft.com on
 * every file listing, every share page, every settings visit - for a badge that
 * appears on one screen after a successful checkout. It is injected on mount
 * instead, once per session, and `loadBadgeScript` dedupes concurrent callers.
 *
 * WHY THERE IS A FALLBACK: `<ms-store-badge>` renders nothing at all until its
 * script defines the element. If get.microsoft.com is blocked - a content
 * blocker, a corporate proxy, an offline tab - the row would silently come up
 * one badge short. On a load error we render the static badge we already ship
 * instead, pointed straight at the Store listing.
 *
 * CSP: get.microsoft.com must be in script-src, img-src, frame-src AND
 * connect-src in public/_headers. The component always appends a 0x0 iframe,
 * and window-mode="direct" fetches the installer, so three of those four are
 * needed even though the badge only ever looks like an image.
 */
import { useEffect, useState } from 'react';

const PRODUCT_ID = '9p1q4pm856st';
const STORE_URL = `https://apps.microsoft.com/store/detail/${PRODUCT_ID}`;
const SCRIPT_SRC = 'https://get.microsoft.com/badge/ms-store-badge.bundled.js';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ms-store-badge': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        productid?: string;
        productname?: string;
        'window-mode'?: string;
        theme?: string;
        size?: string;
        language?: string;
        animation?: string;
      };
    }
  }
}

/** Resolves once the custom element is defined; rejects if the script fails. */
let scriptPromise: Promise<void> | null = null;

function loadBadgeScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    if (customElements.get('ms-store-badge')) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.type = 'module';
    script.src = SCRIPT_SRC;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('ms-store-badge script failed to load')));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

/** The artwork this surface needs, by Microsoft's naming. See THEME above. */
function badgeThemeForSurface(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'light' : 'dark';
}

export function MsStoreBadge({ className = '' }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    typeof document === 'undefined' ? 'dark' : badgeThemeForSurface(),
  );

  useEffect(() => {
    let active = true;
    loadBadgeScript().catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // The element observes `theme`, so re-rendering with a new value swaps the
  // artwork in place - no remount, and no flash of the wrong badge.
  useEffect(() => {
    const sync = () => setTheme(badgeThemeForSurface());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  if (failed) {
    return (
      <a
        href={STORE_URL}
        target="_blank"
        rel="noreferrer"
        className={`transition-opacity hover:opacity-80 ${className}`}
      >
        <img
          src="/badges/msstore.svg"
          alt="Get it from Microsoft"
          width={139}
          height={38}
          className="h-[38px] w-auto"
          loading="lazy"
        />
      </a>
    );
  }

  return (
    // `[&::part(img)]:` reaches the <img> the element exposes as part="img",
    // its only hook on the artwork inside its shadow root. Without the height
    // the badge renders at its intrinsic 44px, six pixels taller than every
    // badge beside it. Tailwind has no built-in part-* variant, so this is the
    // arbitrary-variant form.
    <ms-store-badge
      productid={PRODUCT_ID}
      productname="dosya: Cloud Storage and File Sync"
      window-mode="direct"
      theme={theme}
      size="small"
      language="en-us"
      animation="off"
      className={`inline-block h-[38px] leading-[0] [&::part(img)]:h-[38px] [&::part(img)]:w-auto ${className}`}
    />
  );
}
