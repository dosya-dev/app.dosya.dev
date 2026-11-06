/** Standalone-safe browser contract. Server validates independently; compatibility is tested in apps/api. */
export const LANDINGS = [
  "home",
  "pricing",
  "creator_delivery",
  "video_delivery",
  "photo_delivery",
  "music_delivery",
  "comparison",
  "developer",
  "other",
  "unknown",
] as const;
export const SOURCES = [
  "search_referrer",
  "social_referrer",
  "ai_referrer",
  "other_external",
  "internal",
  "direct_or_unknown",
] as const;
export interface AcquisitionContext {
  v: 1 | 2;
  landing_group: (typeof LANDINGS)[number];
  source_group: (typeof SOURCES)[number];
  captured_at: number;
}
export const STORAGE_KEY = "dosya_acquisition_v1"; // gitleaks:allow - localStorage key name
const PARAM = "acq";
const now = () => Math.floor(Date.now() / 1000);
export function parseContext(
  value: unknown,
  at = now(),
): AcquisitionContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const c = value as Record<string, unknown>;
  if (
    Object.keys(c).sort().join(",") !==
      "captured_at,landing_group,source_group,v" ||
    (c.v !== 1 && c.v !== 2) ||
    (c.v === 1 && c.source_group === "ai_referrer") ||
    !LANDINGS.includes(c.landing_group as never) ||
    !SOURCES.includes(c.source_group as never) ||
    !Number.isSafeInteger(c.captured_at)
  )
    return null;
  return (c.captured_at as number) >= at - 86400 &&
    (c.captured_at as number) <= at + 300
    ? (c as unknown as AcquisitionContext)
    : null;
}
function stored(): AcquisitionContext | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  try {
    return raw && raw.length <= 1024 ? parseContext(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
export function privacySignal(): boolean {
  return (
    navigator.doNotTrack === "1" ||
    (navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl === true
  );
}
function landing(path: string): AcquisitionContext["landing_group"] {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/") return "home";
  if (p === "/pricing") return "pricing";
  if (
    p === "/solutions/creators" ||
    p === "/resources/share-links" ||
    p === "/resources/transfer" ||
    p === "/resources/file-request"
  )
    return "creator_delivery";
  if (p === "/blog/send-audio-files-without-losing-quality")
    return "music_delivery";
  if (p === "/integration/lightroom") return "photo_delivery";
  if (p.startsWith("/compare/")) return "comparison";
  if (
    p.startsWith("/developer/") ||
    [
      "/blog/what-is-webdav",
      "/blog/rclone-s3-compatible-storage",
      "/blog/s3-vs-webdav-for-mounting",
    ].includes(p)
  )
    return "developer";
  if (
    [
      "/blog/send-large-video-files",
      "/blog/video-project-handoff-checklist",
      "/blog/cloud-storage-for-video-editors",
      "/blog/send-video-iphone-android-without-losing-quality",
    ].includes(p)
  )
    return "video_delivery";
  if (
    [
      "/blog/cloud-storage-for-photographers",
      "/blog/photographer-client-galleries",
    ].includes(p)
  )
    return "photo_delivery";
  return "other";
}
function source(
  url: URL,
  referrer: string,
): AcquisitionContext["source_group"] {
  // Observe only exact app origins. Never retain the URL or infer AI from tags.
  // An observed AI origin survives campaign tagging; tags alone remain untrusted.
  try {
    const ref = new URL(referrer);
    if (
      ref.protocol === "https:" &&
      !ref.username &&
      !ref.password &&
      [
        "https://chatgpt.com",
        "https://claude.ai",
        "https://perplexity.ai",
        "https://www.perplexity.ai",
      ].includes(ref.origin)
    )
      return "ai_referrer";
  } catch {
    /* Missing/malformed referrers follow the existing unknown rule. */
  }
  if (
    [...url.searchParams.keys()].some(
      (k) => k.startsWith("utm_") || ["gclid", "fbclid", "msclkid"].includes(k),
    )
  )
    return "other_external";
  if (!referrer) return "direct_or_unknown";
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "");
    if (["dosya.dev", "app.dosya.dev", "help.dosya.dev"].includes(host))
      return "internal";
    if (
      [
        "google.com",
        "google.co.uk",
        "google.ca",
        "google.de",
        "google.fr",
        "google.nl",
        "bing.com",
        "duckduckgo.com",
        "search.yahoo.com",
        "search.brave.com",
        "ecosia.org",
      ].includes(host)
    )
      return "search_referrer";
    if (
      [
        "facebook.com",
        "m.facebook.com",
        "l.facebook.com",
        "instagram.com",
        "l.instagram.com",
        "t.co",
        "x.com",
        "reddit.com",
        "old.reddit.com",
        "linkedin.com",
        "youtube.com",
      ].includes(host)
    )
      return "social_referrer";
    return "other_external";
  } catch {
    return "direct_or_unknown";
  }
}
export function capturePublicContext(
  enabled: boolean,
  optedIn: boolean,
  href: string,
  referrer: string,
): AcquisitionContext | null {
  if (!enabled || !optedIn || privacySignal()) return null;
  try {
    const previous = stored();
    if (previous) return previous;
    const url = new URL(href);
    const c: AcquisitionContext = {
      v: 2,
      landing_group: landing(url.pathname),
      source_group: source(url, referrer),
      captured_at: now(),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    return c;
  } catch {
    return null;
  }
}
export function decorateSignupLinks(
  context: AcquisitionContext | null,
  appOrigin: string,
) {
  for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    try {
      const u = new URL(a.href);
      if (
        u.origin !== new URL(appOrigin).origin ||
        u.pathname.replace(/\/$/, "") !== "/sign-up"
      )
        continue;
      u.searchParams.delete(PARAM);
      if (context) u.searchParams.set(PARAM, JSON.stringify(context));
      a.href = u.href;
    } catch {
      /* Ignore invalid links. */
    }
  }
}
const CONSENT_COOKIE = "dosya_acquisition_consent";
function currentConsent(): boolean {
  const values = document.cookie
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.startsWith(CONSENT_COOKIE + "="));
  return values.length === 1 && values[0] === CONSENT_COOKIE + "=1";
}
function shareConsent(allowed: boolean) {
  // A preference bit, not an identifier. Shared with app/API so a withdrawal
  // also invalidates a context already handed to another origin's tab storage.
  const domain =
    location.hostname === "dosya.dev" ||
    location.hostname.endsWith(".dosya.dev")
      ? ";Domain=dosya.dev"
      : "";
  document.cookie = `${CONSENT_COOKIE}=${allowed ? "1" : "0"};Path=/;Max-Age=31536000;SameSite=Lax;Secure${domain}`;
}
export function installPublicAcquisition(enabled: boolean, appOrigin: string) {
  if (!enabled) return;
  const update = () => {
    let optedIn = false;
    try {
      const cookie = document.cookie
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("cookie_consent="));
      const consent = cookie
        ? JSON.parse(decodeURIComponent(cookie.slice("cookie_consent=".length)))
        : null;
      optedIn = consent?.acquisition === true && !privacySignal();
      shareConsent(optedIn);
      if (!optedIn) sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Blocked storage means unknown attribution. */
    }
    decorateSignupLinks(
      capturePublicContext(true, optedIn, location.href, document.referrer),
      appOrigin,
    );
  };
  update();
  window.addEventListener("cookie-consent-updated", update);
  // Handles links inserted by public components and browser back/forward restores.
  window.addEventListener("pageshow", update);
  document.addEventListener("pointerdown", update, { passive: true });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter") update();
  });
}
export function consumeAcquisition(enabled: boolean) {
  if (!enabled) return;
  const url = new URL(location.href),
    raw = url.searchParams.get(PARAM);
  try {
    if (!currentConsent() || privacySignal())
      sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Blocked cookies/storage means no attribution. */
  }
  if (raw === null) return;
  // Strip immediately, including malformed values. Referral and OAuth parameters are untouched.
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  if (privacySignal() || !currentConsent()) return;
  try {
    const c = raw.length <= 1024 ? parseContext(JSON.parse(raw)) : null;
    if (c && !stored()) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* No attribution is preferable to breaking signup. */
  }
}
let inflight: Promise<void> | null = null;
export async function sendAcquisition(
  enabled: boolean,
  apiBase: string,
): Promise<void> {
  if (!enabled) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      if (privacySignal() || !currentConsent()) {
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      const c = stored();
      if (!c) {
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      const response = await fetch(`${apiBase}/api/me/acquisition`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c),
      });
      // Keep transient errors for the next authenticated boot; invalid context cannot improve on retry.
      if (response.ok || response.status === 400)
        sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Measurement must never interrupt authentication or dashboard boot. */
    }
  })();
  try {
    await inflight;
  } finally {
    inflight = null;
  }
}
