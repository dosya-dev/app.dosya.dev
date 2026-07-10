import { describe, it, expect } from "vitest";
import { humanSize, initials, extOf } from "./helpers";

describe("humanSize", () => {
  it("formats sizes with the right unit", () => {
    expect(humanSize(0)).toBe("0 B");
    expect(humanSize(1024)).toBe("1 KB");
    expect(humanSize(1048576)).toBe("1.0 MB");
  });
});

describe("initials", () => {
  it("takes the first letter of the first two names", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
  });
  it("handles a single name", () => {
    expect(initials("Madonna")).toBe("M");
  });
});

describe("extOf", () => {
  it("extracts and lowercases the extension", () => {
    expect(extOf("photo.PNG")).toBe("png");
  });
  it("returns empty string when there is no extension", () => {
    expect(extOf("noext")).toBe("");
  });
});
