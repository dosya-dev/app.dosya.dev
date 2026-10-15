// Service worker for web push. Receives encrypted pushes and shows OS notifications.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = {}; }
  const title = data.title || "Notification";
  const options = {
    body: data.body || "",
    icon: "/apple-touch-icon.png",
    badge: "/favicon.ico",
    data: { link_path: data.link_path || "/notifications", id: data.id || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.link_path) || "/notifications";
  // An app route is a bare path and is opened in an existing app window. A
  // page the app does not serve arrives as an absolute https URL (an
  // invitation lives on dosya.dev, not app.dosya.dev); WindowClient.navigate
  // is same-origin only, so that gets its own window.
  if (/^https:\/\//.test(path)) {
    event.waitUntil(self.clients.openWindow(path));
    return;
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) { c.focus(); c.navigate(path); return; }
      }
      return self.clients.openWindow(path);
    }),
  );
});
