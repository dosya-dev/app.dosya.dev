import { describe, it, expect } from "vitest";
import { applySummary } from "./notifications";

describe("applySummary", () => {
  it("flags hasNew when the latest id changed", () => {
    const r1 = applySummary({ lastLatestId: null }, { unread: 1, latest: { id: "ntf_a" } as any });
    expect(r1).toEqual({ unread: 1, lastLatestId: "ntf_a", hasNew: true });
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
