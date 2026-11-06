import { cn } from "@/lib/utils";
import { notificationTone, resolveNotificationIcon } from "../../lib/notification-icons.generated";
import { NOTIFICATION_ICON_COMPONENTS } from "./notification-icon-map";

/** Glyphs that point somewhere; they mirror in right-to-left. */
const DIRECTIONAL_KEYS: ReadonlySet<string> = new Set(["log-out", "send", "undo-2"]);

/**
 * The inbox row's glyph: a hairline ring around a 16px line icon.
 *
 * Read state lives in the ring, not in a row background: an unread row's ring
 * and glyph sharpen to the foreground colour, a read row's fade back to muted.
 * Colour is reserved for priority. Important rows take the warning hue and
 * critical rows the destructive hue, which is what the emoji were trying to do
 * with 🚨 and ⚠️, and the one job they did badly.
 */
export function NotificationIcon({
  icon, category, priority, unread = false, className,
}: {
  icon: string | null | undefined;
  category: string | null | undefined;
  priority: string | null | undefined;
  unread?: boolean;
  className?: string;
}) {
  const key = resolveNotificationIcon(icon, category);
  const tone = notificationTone(priority);
  const Glyph = NOTIFICATION_ICON_COMPONENTS[key];
  return (
    <span
      data-icon={key}
      data-tone={tone}
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full border",
        tone === "critical"
          ? "border-destructive/45 text-destructive"
          : tone === "important"
            ? "border-warning/45 text-warning"
            : unread
              ? "border-foreground/35 text-foreground"
              : "border-border text-muted-foreground",
        className,
      )}
    >
      <Glyph className={cn("size-4", DIRECTIONAL_KEYS.has(key) && "rtl:-scale-x-100")} strokeWidth={1.75} />
    </span>
  );
}
