import { describe, it, expect, vi } from "vitest";

vi.mock("@/api/client", () => ({ API_BASE: "https://api.example.com" }));

const { fileRawUrl, fileThumbUrl } = await import("./file-url");

describe("fileRawUrl", () => {
  it("always includes API_BASE (dashboard.tsx used to omit it and broke in prod)", () => {
    expect(fileRawUrl({ fileId: "f1" })).toBe("https://api.example.com/api/files/f1/raw");
  });

  it("adds a version param when given one", () => {
    expect(fileRawUrl({ fileId: "f1", version: 3 })).toBe(
      "https://api.example.com/api/files/f1/raw?version=3",
    );
  });

  it("omits the version param for the current version", () => {
    expect(fileRawUrl({ fileId: "f1", version: 0 })).toBe("https://api.example.com/api/files/f1/raw");
  });

  it("merges extra query params (unlock token, cache-buster)", () => {
    expect(fileRawUrl({ fileId: "f1", query: "ut=tok123" })).toBe(
      "https://api.example.com/api/files/f1/raw?ut=tok123",
    );
    expect(fileRawUrl({ fileId: "f1", version: 2, query: "ut=tok123" })).toBe(
      "https://api.example.com/api/files/f1/raw?version=2&ut=tok123",
    );
  });
});

describe("fileThumbUrl", () => {
  it("points at the thumb endpoint with the size", () => {
    expect(fileThumbUrl({ fileId: "f1", size: 256 })).toBe(
      "https://api.example.com/api/files/f1/thumb?w=256",
    );
  });

  it("carries version and extra query params", () => {
    expect(fileThumbUrl({ fileId: "f1", version: 3, query: "ut=tok", size: 128 })).toBe(
      "https://api.example.com/api/files/f1/thumb?version=3&ut=tok&w=128",
    );
  });
});
