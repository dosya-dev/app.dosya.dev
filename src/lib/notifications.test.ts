import { describe, it, expect, vi } from "vitest";
import { parseActions, relativeTime, groupByDay, isUnread, openDestination, type NotificationItem } from "./notifications";

const base: NotificationItem = {
  id: "ntf_1", kind: "personal", type: "files_downloaded", category: "files",
  priority: "normal", title: "t", body: null, icon: null, link_path: null,
  actions: null, actor_name: null, created_at: 0, read_at: null, dismissed_at: null,
};

describe("parseActions", () => {
  it("parses a valid actions JSON array", () => {
    const json = '[{"handler":"navigate","label":"View","params":{"path":"/files/x"}}]';
    expect(parseActions(json)).toEqual([{ handler: "navigate", label: "View", params: { path: "/files/x" } }]);
  });
  it("returns [] for null or malformed JSON", () => {
    expect(parseActions(null)).toEqual([]);
    expect(parseActions("not json")).toEqual([]);
    expect(parseActions('{"not":"array"}')).toEqual([]);
  });
});

describe("relativeTime", () => {
  it("formats seconds/minutes/hours/days", () => {
    const now = 1_000_000;
    expect(relativeTime(now - 10, now)).toBe("just now");
    expect(relativeTime(now - 120, now)).toBe("2m");
    expect(relativeTime(now - 3 * 3600, now)).toBe("3h");
    expect(relativeTime(now - 2 * 86400, now)).toBe("2d");
  });
});

describe("groupByDay", () => {
  it("splits into Today and Earlier by local day", () => {
    const now = 1_700_000_000; // fixed
    const today = { ...base, id: "a", created_at: now - 60 };
    const earlier = { ...base, id: "b", created_at: now - 3 * 86400 };
    const groups = groupByDay([today, earlier], now);
    expect(groups[0].label).toBe("Today");
    expect(groups[0].items.map((i) => i.id)).toEqual(["a"]);
    expect(groups[1].label).toBe("Earlier");
    expect(groups[1].items.map((i) => i.id)).toEqual(["b"]);
  });
  it("omits empty groups", () => {
    const now = 1_700_000_000;
    const groups = groupByDay([{ ...base, created_at: now - 60 }], now);
    expect(groups.map((g) => g.label)).toEqual(["Today"]);
  });

  it("uses the viewer's local midnight, not UTC midnight", () => {
    // In UTC+3, local midnight is 21:00 UTC the previous day. Anything the
    // user sees as "this morning" between 00:00 and 02:59 local is still
    // yesterday in UTC, and a UTC boundary files it under "Earlier".
    const original = process.env.TZ;
    process.env.TZ = "Europe/Istanbul"; // UTC+3, no DST
    try {
      const localMidnight = new Date("2026-07-30T00:00:00+03:00").getTime() / 1000;
      const thisMorning = localMidnight + 3600; // 01:00 local, 22:00 UTC yesterday
      const lastNight = localMidnight - 3600;   // 23:00 local the previous day
      const now = localMidnight + 12 * 3600;    // midday local

      const groups = groupByDay(
        [
          { ...base, id: "morning", created_at: thisMorning },
          { ...base, id: "lastnight", created_at: lastNight },
        ],
        now,
      );
      expect(groups[0].label).toBe("Today");
      expect(groups[0].items.map((i) => i.id)).toEqual(["morning"]);
      expect(groups[1].items.map((i) => i.id)).toEqual(["lastnight"]);
    } finally {
      process.env.TZ = original;
    }
  });
});

describe("isUnread", () => {
  it("is unread when read_at is null", () => {
    expect(isUnread(base)).toBe(true);
    expect(isUnread({ ...base, read_at: 123 })).toBe(false);
  });
});

describe("openDestination", () => {
  // An invitation lands on dosya.dev/invite/<token>, a page the marketing site
  // serves. The server sends it as an absolute URL; handing that to the app
  // router produced an in-app path on app.dosya.dev, a 404.
  it("leaves the app for an absolute https URL", () => {
    const navigate = vi.fn();
    const assign = vi.fn();
    openDestination("https://dosya.dev/invite/tok_abc", navigate, assign);
    expect(assign).toHaveBeenCalledWith("https://dosya.dev/invite/tok_abc");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("routes an app path in place", () => {
    const navigate = vi.fn();
    const assign = vi.fn();
    openDestination("/files/x", navigate, assign);
    expect(navigate).toHaveBeenCalledWith("/files/x");
    expect(assign).not.toHaveBeenCalled();
  });

  it("does nothing for an empty destination", () => {
    const navigate = vi.fn();
    const assign = vi.fn();
    openDestination(null, navigate, assign);
    expect(navigate).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});
