import { describe, it, expect } from "vitest";
import { parseActions, relativeTime, groupByDay, isUnread, type NotificationItem } from "./notifications";

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
