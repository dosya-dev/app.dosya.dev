import { describe, it, expect, vi } from "vitest";

vi.mock("@/api/client", () => ({ API_BASE: "https://api.example.com" }));

const { fileRawUrl } = await import("./file-url");

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
