import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Bell, CheckCheck, Settings } from "lucide-react";
import { useNotifications } from "../../stores/notifications";
import { groupByDay } from "../../lib/notifications";
import { NotificationCard } from "./notification-card";

export function NotificationBell() {
  const navigate = useNavigate();
  const { unread, items, open, loading, setOpen, markAll } = useNotifications();
  const now = Math.floor(Date.now() / 1000);
  const groups = groupByDay(items, now);

  // The badge pops only when the count goes 0 -> n, which is the moment
  // something actually arrived. Without this it would replay on every poll
  // that re-renders the bell, and a badge that keeps flinching reads as a bug.
  const prevUnread = useRef<number | null>(null);
  useEffect(() => { prevUnread.current = unread; }, [unread]);
  const justArrived = prevUnread.current === 0 && unread > 0;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        className="size-9 p-0 relative inline-flex items-center justify-center rounded-md border hover:bg-muted"
        aria-label="Notifications"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span
            className={`absolute -top-1 -right-1 min-w-4 h-4 px-1 flex items-center justify-center text-[10px] font-semibold rounded-full bg-green-600 text-white ${justArrived ? "animate-badge-in" : ""}`}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </PopoverPrimitive.Trigger>

      {/* Was a hand-rolled `{open && <div className="absolute …">}`: the only
          popover in the app that appeared out of nowhere and vanished the same
          way, while every sibling surface grew out of its trigger. Base UI
          supplies --transform-origin and the data-open/data-closed states, so
          the motion here is the same string the dropdowns and selects use
          rather than a second hand-written implementation. It also owns the
          outside-click and Escape handling that used to live in an effect. */}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner className="isolate z-50 outline-none" align="end" side="bottom" sideOffset={8}>
          <PopoverPrimitive.Popup
            className="w-80 max-h-[70vh] flex flex-col bg-popover text-popover-foreground border rounded-xl shadow-xl overflow-hidden origin-(--transform-origin) duration-150 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-2"
          >
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
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
