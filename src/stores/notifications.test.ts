import { describe, it, expect } from "vitest";
import { applySummary } from "./notifications";

describe("applySummary", () => {
  it("does NOT flag hasNew on first load (no prior latest) — only records the id", () => {
    const r = applySummary({ lastLatestId: null }, { unread: 1, latest: { id: "ntf_a" } as any });
    expect(r).toEqual({ unread: 1, lastLatestId: "ntf_a", hasNew: false });
  });
  it("flags hasNew when a new notification arrives after one was already seen", () => {
    const r = applySummary({ lastLatestId: "ntf_a" }, { unread: 2, latest: { id: "ntf_b" } as any });
    expect(r).toEqual({ unread: 2, lastLatestId: "ntf_b", hasNew: true });
  });
  it("does not flag hasNew when latest id is unchanged", () => {
    const r = applySummary({ lastLatestId: "ntf_a" }, { unread: 2, latest: { id: "ntf_a" } as any });
    expect(r.hasNew).toBe(false);
    expect(r.unread).toBe(2);
  });
  it("handles an empty inbox", () => {
    const r = applySummary({ lastLatestId: "ntf_a" }, { unread: 0, latest: null });
    expect(r).toEqual({ unread: 0, lastLatestId: "ntf_a", hasNew: false });
  });
});
