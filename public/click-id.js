// Ad-click attribution, first-party only. A click on one of our Reddit ads
// lands with ?rdt_cid=<click id>; keep it in a cookie on .dosya.dev so the API
// can report the eventual sign-up to Reddit server-to-server (see
// apps/api/src/lib/reddit-capi.ts). No Reddit script runs here and no
// third-party cookie is set. Same logic as the marketing site's Layout.astro,
// for ads that link straight to app.dosya.dev/sign-up. Skipped when the
// visitor has already rejected optional cookies on dosya.dev; "Reject" in
// that banner clears it. A plain file rather than inline because this app's
// CSP has no 'unsafe-inline' for scripts.
(function () {
  try {
    var m = /[?&]rdt_cid=([^&#]+)/.exec(location.search);
    if (!m) return;
    var id = decodeURIComponent(m[1]);
    if (!/^[A-Za-z0-9_.-]{1,256}$/.test(id)) return;
    var consent = /(?:^|;\s*)cookie_consent=([^;]*)/.exec(document.cookie);
    if (consent && /"functional"\s*:\s*false/.test(decodeURIComponent(consent[1]))) return;
    var host = location.hostname;
    var scope = host === 'dosya.dev' || host.endsWith('.dosya.dev') ? ';Domain=.dosya.dev;Secure' : '';
    document.cookie = 'dosya_rdt_cid=' + id + ';Max-Age=2592000;Path=/;SameSite=Lax' + scope;
  } catch (e) {}
})();
