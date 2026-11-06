// Tab attention for unseen support replies: a "(n) New message from Carl · " prefix
// on document.title and a red dot on the favicon. The support-chat store is the
// only caller (one owner for cues).
//
// page-title.tsx keeps owning the title: this module wraps whatever title is
// current, and a MutationObserver re-wraps when RouteTitle/useDocumentTitle set
// a new one while attention is on, so clearing restores the page's latest title.
// Everything is best effort and a no-op without a document.

export type AttentionLabel = (count: number, name: string) => string;

const FALLBACK_NAME = 'dosya support';
const SEP = ' · ';
const SIZE = 32;
const defaultLabel: AttentionLabel = (count, name) => `(${count}) New message from ${name}`;

let label: AttentionLabel = defaultLabel;
let active = false;
/** The page's own title, as page-title.tsx last set it. */
let base = '';
/** The exact title this module wrote, to tell our writes from the page's. */
let applied = '';
let prefix = '';
let observer: MutationObserver | null = null;
let savedIcons: Array<{ link: HTMLLinkElement; href: string | null; type: string | null }> | null = null;
let drawToken = 0;
let drawing = false;

/** Install a translated prefix (the panel passes its catalog string); null restores English. */
export function setAttentionLabel(fn: AttentionLabel | null): void {
  label = fn ?? defaultLabel;
}

export function setAttention({ count, personaName }: { count: number; personaName: string | null }): void {
  if (typeof document === 'undefined') return;
  try {
    const current = document.title;
    if (!active) base = current;
    else if (current !== applied) base = strip(current);
    prefix = label(count, personaName || FALLBACK_NAME);
    active = true;
    writeTitle();
    watchTitle();
    showDot();
  } catch { /* attention is a courtesy */ }
}

export function clearAttention(): void {
  if (!active || typeof document === 'undefined') return;
  active = false;
  drawToken++;
  drawing = false;
  try {
    observer?.disconnect();
    observer = null;
    if (rewriteReset) { clearTimeout(rewriteReset); rewriteReset = null; }
    rewrites = 0;
    document.title = document.title === applied ? base : strip(document.title);
    restoreIcons();
  } catch { /* attention is a courtesy */ }
}

// --- title ------------------------------------------------------------------

/**
 * The form `document.title` reads back as: browsers strip and collapse ASCII
 * whitespace, so "Ana  Silva" is read as "Ana Silva". Every comparison uses
 * this form, or a persona name with a double space or a newline would never
 * match what we wrote and the observer would re-wrap forever.
 */
function readBack(s: string): string {
  return s.replace(/[\t\n\f\r ]+/g, ' ').trim();
}

function strip(title: string): string {
  if (!prefix) return title;
  const p = readBack(prefix);
  if (title === p) return '';
  return title.startsWith(p + SEP) ? title.slice(p.length + SEP.length) : title;
}

function writeTitle(): void {
  const next = base ? `${prefix}${SEP}${base}` : prefix;
  if (document.title !== readBack(next)) document.title = next;
  applied = document.title;
}

/** Observer rewrites since the last macrotask; a hard stop against any read-back mismatch looping. */
const MAX_REWRITES = 5;
let rewrites = 0;
let rewriteReset: ReturnType<typeof setTimeout> | null = null;

function watchTitle(): void {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver(() => {
    if (!active || document.title === applied) return;
    if (rewrites >= MAX_REWRITES) return;
    rewrites++;
    rewriteReset ??= setTimeout(() => { rewrites = 0; rewriteReset = null; }, 0);
    base = strip(document.title);
    writeTitle();
  });
  observer.observe(document.head, { subtree: true, childList: true, characterData: true });
}

// --- favicon ----------------------------------------------------------------

function iconLinks(): HTMLLinkElement[] {
  return [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];
}

function showDot(): void {
  // Already showing or already drawing; the dot does not carry the count.
  if (savedIcons || drawing) return;
  const token = ++drawToken;
  drawing = true;
  const svg = iconLinks().find((l) => l.type === 'image/svg+xml')?.getAttribute('href') ?? '/favicon.svg';
  renderDot(svg, (url) => {
    if (token !== drawToken) return; // cleared (and maybe set again) meanwhile
    drawing = false;
    if (url && active && !savedIcons) swapIcons(url);
  });
}

function renderDot(src: string, done: (url: string | null) => void): void {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext('2d');
  if (!g || typeof Image === 'undefined') { done(null); return; } // no canvas: the title alone carries the cue
  const finish = (img: HTMLImageElement | null) => {
    try {
      if (img) {
        g.drawImage(img, 0, 0, SIZE, SIZE);
      } else {
        g.fillStyle = '#18181b';
        g.beginPath();
        g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, Math.PI * 2);
        g.fill();
      }
      // A static dot (no pulse), so prefers-reduced-motion needs nothing extra.
      g.fillStyle = '#ef4444';
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(SIZE - 8, 8, 7, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      done(canvas.toDataURL('image/png'));
    } catch {
      done(null); // tainted or unsupported canvas: keep the original icon
    }
  };
  const img = new Image();
  img.onload = () => finish(img);
  img.onerror = () => finish(null);
  img.src = src;
}

function swapIcons(url: string): void {
  const links = iconLinks();
  if (links.length === 0) return;
  savedIcons = links.map((link) => ({ link, href: link.getAttribute('href'), type: link.getAttribute('type') }));
  for (const link of links) {
    link.setAttribute('href', url);
    link.setAttribute('type', 'image/png');
  }
}

function restoreIcons(): void {
  const saved = savedIcons;
  savedIcons = null;
  if (!saved) return;
  for (const { link, href, type } of saved) {
    if (href === null) link.removeAttribute('href'); else link.setAttribute('href', href);
    if (type === null) link.removeAttribute('type'); else link.setAttribute('type', type);
  }
}
