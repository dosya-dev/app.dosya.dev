import { getVapidKey, subscribePush, unsubscribePush } from "../api/notifications";

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window;
}

export async function enableWebPush(): Promise<"enabled" | "denied" | "unsupported"> {
  if (!supported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  const reg = await navigator.serviceWorker.ready;
  const key = await getVapidKey();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
  });
  await subscribePush(sub.toJSON() as PushSubscriptionJSON, navigator.userAgent.slice(0, 80));
  return "enabled";
}

export async function disableWebPush(): Promise<void> {
  if (!supported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { await unsubscribePush(sub.endpoint); await sub.unsubscribe(); }
}
