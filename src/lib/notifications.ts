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

export function relativeTime(createdAt: number, now: number): string {
  const s = Math.max(0, now - createdAt);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function isUnread(item: NotificationItem): boolean {
  return item.read_at == null;
}

export function groupByDay(items: NotificationItem[], now: number): { label: string; items: NotificationItem[] }[] {
  const startOfToday = Math.floor(now / 86400) * 86400; // UTC day boundary; fine for grouping
  const today: NotificationItem[] = [];
  const earlier: NotificationItem[] = [];
  for (const it of items) (it.created_at >= startOfToday ? today : earlier).push(it);
  const groups: { label: string; items: NotificationItem[] }[] = [];
  if (today.length) groups.push({ label: "Today", items: today });
  if (earlier.length) groups.push({ label: "Earlier", items: earlier });
  return groups;
}
