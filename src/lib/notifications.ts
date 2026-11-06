import { t } from "@/lib/i18n";

export interface NotificationItem {
  id: string;
  kind: "personal" | "broadcast";
  type: string;
  category: string;
  priority: string;
  title: string;
  body: string | null;
  icon: string | null;
  link_path: string | null;
  actions: string | null;
  actor_name: string | null;
  created_at: number;
  read_at: number | null;
  dismissed_at: number | null;
}

export interface NotificationAction {
  handler: "navigate" | "dismiss";
  label: string;
  params?: { path?: string };
}

const KNOWN_HANDLERS = new Set(["navigate", "dismiss"]);

export function parseActions(json: string | null): NotificationAction[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a) => a && typeof a.label === "string" && KNOWN_HANDLERS.has(a.handler),
    ) as NotificationAction[];
  } catch {
    return [];
  }
}

/**
 * Open a notification's destination.
 *
 * The server sends an app route as a bare path and anything the app does not
 * serve as an absolute https URL: a workspace invitation lands on
 * dosya.dev/invite/<token>, a marketing-site page. It used to arrive bare, and
 * routing it in place opened app.dosya.dev/invite/<token>, a 404. The host now
 * comes with it, and that cannot go through navigate() either: react-router
 * treats an absolute URL as a relative path. An absolute URL is a document
 * navigation, not a route change.
 */
export function openDestination(
  path: string | null | undefined,
  navigate: (path: string) => void,
  assign: (url: string) => void = (url) => window.location.assign(url),
): void {
  if (!path) return;
  if (path.startsWith("https://")) assign(path);
  else navigate(path);
}

export function relativeTime(createdAt: number, now: number): string {
  const s = Math.max(0, now - createdAt);
  if (s < 60) return t("common.label.justNow");
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function isUnread(item: NotificationItem): boolean {
  return item.read_at == null;
}

export function groupByDay(items: NotificationItem[], now: number): { label: string; items: NotificationItem[] }[] {
  // Local midnight, not UTC midnight. "Today" is a claim about the viewer's
  // calendar: east of UTC, a UTC boundary pushed the user's own early-morning
  // notifications into "Earlier", and west of it, yesterday evening's showed
  // up under "Today".
  const midnight = new Date(now * 1000);
  midnight.setHours(0, 0, 0, 0);
  const startOfToday = Math.floor(midnight.getTime() / 1000);
  const today: NotificationItem[] = [];
  const earlier: NotificationItem[] = [];
  for (const it of items) (it.created_at >= startOfToday ? today : earlier).push(it);
  const groups: { label: string; items: NotificationItem[] }[] = [];
  if (today.length) groups.push({ label: t("common.label.today"), items: today });
  if (earlier.length) groups.push({ label: t("common.label.earlier"), items: earlier });
  return groups;
}
