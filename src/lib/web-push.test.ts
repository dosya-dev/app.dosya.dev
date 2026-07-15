import { describe, it, expect } from "vitest";
import { urlBase64ToUint8Array } from "./web-push";

describe("urlBase64ToUint8Array", () => {
  it("decodes a url-safe base64 VAPID key to bytes", () => {
    // "hello" in standard base64 is "aGVsbG8="; url-safe without padding: "aGVsbG8"
    const bytes = urlBase64ToUint8Array("aGVsbG8");
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111]); // h e l l o
  });
});
