import { describe, it, expect } from "vitest";
import { humanSize, initials, extOf, isImage, isHeic, fileIconSrc } from "./helpers";

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

describe("isImage", () => {
  it("treats heic/heif as images", () => {
    expect(isImage("IMG_0001.heic")).toBe(true);
    expect(isImage("IMG_0001.heif")).toBe(true);
  });

  it("is case-insensitive (iPhones produce .HEIC)", () => {
    expect(isImage("IMG_0001.HEIC")).toBe(true);
  });

  it("still recognizes the existing formats and rejects non-images", () => {
    expect(isImage("a.jpg")).toBe(true);
    expect(isImage("a.png")).toBe(true);
    expect(isImage("a.pdf")).toBe(false);
  });
});

describe("isHeic", () => {
  it("is true only for heic/heif", () => {
    expect(isHeic("a.heic")).toBe(true);
    expect(isHeic("a.HEIF")).toBe(true);
    expect(isHeic("a.jpg")).toBe(false);
    expect(isHeic("a.pdf")).toBe(false);
  });
});

describe("fileIconSrc", () => {
  it("gives heic a photo icon, not the default text icon", () => {
    expect(fileIconSrc("a.heic")).toBe("/file-icons/009-jpg.svg");
  });
});
