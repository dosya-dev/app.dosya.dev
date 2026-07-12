import { describe, it, expect } from "vitest";
import { parseUA } from "./ua";

describe("parseUA", () => {
  it("Chrome on macOS", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(parseUA(ua)).toEqual({ browser: "Chrome 120", os: "macOS" });
  });
  it("Safari on iOS", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(parseUA(ua)).toEqual({ browser: "Safari 17", os: "iOS" });
  });
  it("Edge on Windows (not misread as Chrome)", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
    expect(parseUA(ua)).toEqual({ browser: "Edge 120", os: "Windows" });
  });
  it("Firefox on Linux", () => {
    expect(parseUA("Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0"))
      .toEqual({ browser: "Firefox 121", os: "Linux" });
  });
  it("null / empty → Unknown", () => {
    expect(parseUA(null)).toEqual({ browser: "Unknown", os: "" });
    expect(parseUA("")).toEqual({ browser: "Unknown", os: "" });
  });
});
