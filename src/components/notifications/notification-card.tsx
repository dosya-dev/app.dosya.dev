import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { parseActions, relativeTime, isUnread, type NotificationItem } from "../../lib/notifications";
import { useNotifications } from "../../stores/notifications";

export function NotificationCard({ item }: { item: NotificationItem }) {
  const navigate = useNavigate();
  const markItemRead = useNotifications((s) => s.markItemRead);
  const dismissItem = useNotifications((s) => s.dismissItem);
  const setOpen = useNotifications((s) => s.setOpen);
  const actions = parseActions(item.actions);
  const now = Math.floor(Date.now() / 1000);

  function goTo(path: string | null) {
    if (!path) return;
    markItemRead(item.id);
    setOpen(false);
    navigate(path);
  }

  return (
    <div
      className={`group flex gap-3 px-3 py-2.5 hover:bg-muted/50 cursor-pointer ${isUnread(item) ? "bg-muted/20" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => goTo(item.link_path)}
      onKeyDown={(e) => { if (e.key === "Enter") goTo(item.link_path); }}
    >
      <div className="text-lg leading-none pt-0.5 select-none">{item.icon ?? "🔔"}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="text-sm font-medium truncate">{item.title}</p>
          {isUnread(item) && <span className="mt-1 size-1.5 rounded-full bg-green-500 shrink-0" />}
          <span className="ml-auto text-xs text-muted-foreground shrink-0">{relativeTime(item.created_at, now)}</span>
        </div>
        {item.body && <p className="text-sm text-muted-foreground line-clamp-2">{item.body}</p>}
        {actions.length > 0 && (
          <div className="mt-1.5 flex gap-1.5">
            {actions.map((a, idx) => (
              <button
                key={idx}
                className="text-xs px-2 py-1 rounded-md border hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  if (a.handler === "dismiss") { dismissItem(item.id); return; }
                  goTo(a.params?.path ?? item.link_path);
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        aria-label="Dismiss"
        className="opacity-0 group-hover:opacity-100 self-start text-muted-foreground hover:text-foreground"
        onClick={(e) => { e.stopPropagation(); dismissItem(item.id); }}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
