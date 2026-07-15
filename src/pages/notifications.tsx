import { useEffect, useState, useCallback } from "react";
import { fetchList } from "../api/notifications";
import { groupByDay, type NotificationItem } from "../lib/notifications";
import { NotificationCard } from "../components/notifications/notification-card";

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [before, setBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const now = Math.floor(Date.now() / 1000);

  const load = useCallback(async (cursor?: number) => {
    setLoading(true);
    try {
      const { items: page, nextBefore } = await fetchList(cursor);
      setItems((prev) => (cursor ? [...prev, ...page] : page));
      setBefore(nextBefore);
      if (!nextBefore) setDone(true);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const groups = groupByDay(items, now);

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-4">Notifications</h1>
      {items.length === 0 && !loading && <p className="text-muted-foreground text-center py-12">Nothing here yet.</p>}
      <div className="border rounded-xl overflow-hidden divide-y">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/30">{g.label}</div>
            {g.items.map((it) => <NotificationCard key={it.id} item={it} />)}
          </div>
        ))}
      </div>
      {!done && items.length > 0 && (
        <div className="text-center mt-4">
          <button className="text-sm px-3 py-1.5 rounded-md border hover:bg-muted" disabled={loading} onClick={() => before && load(before)}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
