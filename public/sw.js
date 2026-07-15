// Service worker for web push. Receives encrypted pushes and shows OS notifications.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = {}; }
  const title = data.title || "Notification";
  const options = {
    body: data.body || "",
    icon: "/logo.svg",
    badge: "/favicon.ico",
    data: { link_path: data.link_path || "/notifications", id: data.id || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.link_path) || "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) { c.focus(); c.navigate(path); return; }
      }
      return self.clients.openWindow(path);
    }),
  );
});
