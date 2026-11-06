import { describe, expect, it, vi } from "vitest";
import { handle } from "./worker";

const env = () => ({ ASSETS: { fetch: vi.fn(async () => new Response("<!doctype html>", { status: 200 })) } });

describe("app.dosya.dev worker", () => {
    it("answers a missing hashed chunk with an uncacheable 404, never the SPA shell", async () => {
        const e = env();
        const res = await handle(new Request("https://app.dosya.dev/assets/uploads-CdIkSgj4.js"), e);
        expect(res.status).toBe(404);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(e.ASSETS.fetch).not.toHaveBeenCalled();
    });

    it("hands every other unmatched path to the asset layer's SPA fallback", async () => {
        const e = env();
        const req = new Request("https://app.dosya.dev/files/abc");
        const res = await handle(req, e);
        expect(res.status).toBe(200);
        expect(e.ASSETS.fetch).toHaveBeenCalledWith(req);
    });

    it("does not treat a lookalike path as an asset", async () => {
        const e = env();
        await handle(new Request("https://app.dosya.dev/assetsx/thing"), e);
        expect(e.ASSETS.fetch).toHaveBeenCalledOnce();
    });
});
