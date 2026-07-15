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
});

describe("isUnread", () => {
  it("is unread when read_at is null", () => {
    expect(isUnread(base)).toBe(true);
    expect(isUnread({ ...base, read_at: 123 })).toBe(false);
  });
});
