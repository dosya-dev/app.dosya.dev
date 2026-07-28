// Apply the saved theme + mode before first paint (no flash on refresh).
(function () {
  try {
    var theme = 'default', mode = 'system';
    var raw = localStorage.getItem('ui-theme');
    if (raw) {
      var p = JSON.parse(raw);
      if (p && p.theme) theme = p.theme;
      if (p && p.mode) mode = p.mode;
    } else {
      var legacy = localStorage.getItem('theme');
      if (legacy === 'dark' || legacy === 'light') mode = legacy;
    }
    var el = document.documentElement;
    if (theme && theme !== 'default') el.setAttribute('data-theme', theme);
    var dark = mode === 'dark' ||
      (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) el.classList.add('dark');
  } catch (e) {}
})();
