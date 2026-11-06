// The static splash in index.html stays up until React mounts. If the app's
// script never arrives (a stalled chunk download, a dropped connection) the
// seal would breathe forever with nothing to press, so after a while this adds
// a Reload button under it. React replacing #root's children removes the
// splash, and with it this button, so a healthy load never sees it. Mirrors
// components/ui/loading-escape.tsx, which covers the waits after mount.
// External because the CSP forbids inline scripts.
(function () {
  setTimeout(function () {
    var splash = document.getElementById('splash');
    if (!splash || splash.querySelector('.splash-escape')) return;
    var box = document.createElement('div');
    box.className = 'splash-escape';
    var p = document.createElement('p');
    p.textContent = 'This is taking longer than it should.';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Reload';
    btn.addEventListener('click', function () { location.reload(); });
    box.appendChild(p);
    box.appendChild(btn);
    splash.appendChild(box);
  }, 10000);
})();
