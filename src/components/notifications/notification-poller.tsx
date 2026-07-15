import { useEffect } from "react";
import { useNotifications } from "../../stores/notifications";
import { toast } from "../../lib/toast";

const POLL_MS = 20_000;

export function NotificationPoller() {
  const refreshSummary = useNotifications((s) => s.refreshSummary);
  const setOnNew = useNotifications((s) => s.setOnNew);

  useEffect(() => {
    setOnNew((item) => toast.info(item.title, item.body ?? undefined));
  }, [setOnNew]);

  useEffect(() => {
    refreshSummary();
    const id = setInterval(refreshSummary, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") refreshSummary(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [refreshSummary]);

  return null;
}
