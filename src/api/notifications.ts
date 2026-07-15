import { api } from "./client";
import type { NotificationItem } from "../lib/notifications";

export function fetchSummary() {
  return api<{ ok: boolean; unread: number; latest: NotificationItem | null }>("/api/notifications/summary")
    .then((r) => ({ unread: r.unread, latest: r.latest }));
}

export function fetchList(before?: number) {
  const q = before ? `?before=${before}` : "";
  return api<{ ok: boolean; items: NotificationItem[]; nextBefore: number | null }>(`/api/notifications${q}`)
    .then((r) => ({ items: r.items, nextBefore: r.nextBefore }));
}

export function markRead(id: string) {
  return api(`/api/notifications/${id}/read`, { method: "POST" }).then(() => undefined);
}

export function markAllRead() {
  return api(`/api/notifications/read-all`, { method: "POST" }).then(() => undefined);
}

export function dismiss(id: string) {
  return api(`/api/notifications/${id}/dismiss`, { method: "POST" }).then(() => undefined);
}

export function runAction(id: string, handler: string, params?: object) {
  return api<{ ok: boolean; next: { path: string } | null }>(`/api/notifications/${id}/action`, {
    method: "POST", body: JSON.stringify({ handler, params }),
  }).then((r) => ({ next: r.next }));
}

export function getVapidKey() {
  return api<{ ok: boolean; key: string }>("/api/notifications/push/vapid-key").then((r) => r.key);
}

export function subscribePush(sub: PushSubscriptionJSON, deviceName: string) {
  return api("/api/notifications/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys, device_name: deviceName }),
  }).then(() => undefined);
}

export function unsubscribePush(endpoint: string) {
  return api("/api/notifications/push/subscribe", {
    method: "DELETE", body: JSON.stringify({ endpoint }),
  }).then(() => undefined);
}
