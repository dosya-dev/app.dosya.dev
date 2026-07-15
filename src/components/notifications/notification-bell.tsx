import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, Settings } from "lucide-react";
import { useNotifications } from "../../stores/notifications";
import { groupByDay } from "../../lib/notifications";
import { NotificationCard } from "./notification-card";

export function NotificationBell() {
  const navigate = useNavigate();
  const { unread, items, open, loading, setOpen, markAll } = useNotifications();
  const ref = useRef<HTMLDivElement>(null);
  const now = Math.floor(Date.now() / 1000);
  const groups = groupByDay(items, now);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, setOpen]);

  return (
    <div className="relative" ref={ref}>
      <button
        className="size-9 p-0 relative inline-flex items-center justify-center rounded-md border hover:bg-muted"
        aria-label="Notifications"
        onClick={() => setOpen(!open)}
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 flex items-center justify-center text-[10px] font-semibold rounded-full bg-green-600 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-[70vh] flex flex-col bg-popover text-popover-foreground border rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-sm font-semibold">Notifications</span>
            <button className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1" onClick={() => markAll()}>
              <CheckCheck className="size-3.5" /> Mark all read
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading && items.length === 0 && <p className="px-3 py-6 text-sm text-muted-foreground text-center">Loading…</p>}
            {!loading && items.length === 0 && <p className="px-3 py-6 text-sm text-muted-foreground text-center">You're all caught up 🎉</p>}
            {groups.map((g) => (
              <div key={g.label}>
                <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{g.label}</div>
                {g.items.map((it) => <NotificationCard key={it.id} item={it} />)}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-3 py-2 border-t text-xs">
            <button className="text-muted-foreground hover:text-foreground" onClick={() => { setOpen(false); navigate("/notifications"); }}>
              See all
            </button>
            <button className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1" onClick={() => { setOpen(false); navigate("/profile#section-notifications"); }}>
              <Settings className="size-3.5" /> Settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
