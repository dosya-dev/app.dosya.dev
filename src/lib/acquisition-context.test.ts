import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  capturePublicContext,
  decorateSignupLinks,
  consumeAcquisition,
  sendAcquisition,
  parseContext,
  STORAGE_KEY,
} from "./acquisition-context";
const now = 1792800000;
const c = {
  v: 2,
  landing_group: "home",
  source_group: "search_referrer",
  captured_at: now,
};
beforeEach(() => {
  sessionStorage.clear();
  document.cookie = "dosya_acquisition_consent=1;path=/";
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  vi.spyOn(Date, "now").mockReturnValue(now * 1000);
});
afterEach(() => vi.restoreAllMocks());
describe("bounded attribution handoff", () => {
  it.each([
    ["/blog/send-audio-files-without-losing-quality", "music_delivery"],
    ["/blog/send-audio-files-without-losing-quality/", "music_delivery"],
    ["/resources/transfer/", "creator_delivery"],
    ["/resources/file-request/", "creator_delivery"],
    ["/developer/s3/", "developer"],
    ["/developer/webdav/", "developer"],
    ["/developer/rclone/", "developer"],
    ["/blog/rclone-s3-compatible-storage", "developer"],
  ])("hands off the bounded cohort for completed landing %s", (path, group) => {
    const context = capturePublicContext(
      true,
      true,
      `https://dosya.dev${path}?utm_campaign=private-campaign#private-fragment`,
      "https://www.google.com/search?q=private-query",
    );
    document.body.innerHTML =
      '<a href="https://app.dosya.dev/sign-up?ref=friend">Join</a>';
    decorateSignupLinks(context, "https://app.dosya.dev");
    const target = new URL(document.querySelector("a")!.href);
    expect(JSON.parse(target.searchParams.get("acq")!)).toEqual({
      v: 2,
      landing_group: group,
      source_group: "other_external",
      captured_at: now,
    });
    expect(target.searchParams.get("ref")).toBe("friend");
    expect(target.href).not.toContain("private");
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toContain("private");
  });
  it("does not infer an audio cohort from a similar unlisted path", () => {
    expect(
      capturePublicContext(
        true,
        true,
        "https://dosya.dev/blog/send-audio-files-without-losing-quality-private",
        "",
      ),
    ).toMatchObject({ landing_group: "other" });
  });
  it("does nothing without the flag and explicit opt-in", () => {
    const get = vi.spyOn(Storage.prototype, "getItem");
    expect(
      capturePublicContext(
        false,
        true,
        "https://dosya.dev/",
        "https://google.com",
      ),
    ).toBeNull();
    expect(
      capturePublicContext(
        true,
        false,
        "https://dosya.dev/",
        "https://google.com",
      ),
    ).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
  it("retains only the first category, never referrer/query data, and expires after 24 hours", () => {
    expect(
      capturePublicContext(
        true,
        true,
        "https://dosya.dev/",
        "https://www.google.com/search?q=secret",
      ),
    ).toEqual(c);
    expect(
      capturePublicContext(true, true, "https://dosya.dev/pricing", ""),
    ).toEqual(c);
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toContain("secret");
    vi.spyOn(Date, "now").mockReturnValue((now + 86401) * 1000);
    expect(
      capturePublicContext(true, true, "https://dosya.dev/pricing", ""),
    ).toMatchObject({
      landing_group: "pricing",
      source_group: "direct_or_unknown",
    });
  });
  it("never calls tagged campaigns organic or trusts lookalike search hosts", () => {
    expect(
      capturePublicContext(
        true,
        true,
        "https://dosya.dev/?utm_source=google",
        "https://google.com",
      ),
    ).toMatchObject({ source_group: "other_external" });
    sessionStorage.clear();
    expect(
      capturePublicContext(
        true,
        true,
        "https://dosya.dev/",
        "https://google.com.evil.test",
      ),
    ).toMatchObject({ source_group: "other_external" });
  });
  it("decorates only trusted signup links, preserving referral parameters; consumes and scrubs only its own parameter", () => {
    document.body.innerHTML =
      '<a id="yes" href="https://app.dosya.dev/sign-up?ref=friend#form">Join</a><a id="no" href="https://evil.test/sign-up">Other</a>';
    decorateSignupLinks(c as never, "https://app.dosya.dev");
    const url = new URL(
      (document.getElementById("yes") as HTMLAnchorElement).href,
    );
    expect(url.searchParams.get("ref")).toBe("friend");
    expect(url.hash).toBe("#form");
    expect((document.getElementById("no") as HTMLAnchorElement).search).toBe(
      "",
    );
    window.history.replaceState({}, "", `/sign-up${url.search}#form`);
    consumeAcquisition(true);
    expect(window.location.search).toBe("?ref=friend");
    expect(window.location.hash).toBe("#form");
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)).toEqual(c);
  });
  it("rejects poisoned input and works when storage is blocked", () => {
    expect(parseContext({ ...c, query: "private" }, now)).toBeNull();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw Error("blocked");
    });
    expect(
      capturePublicContext(true, true, "https://dosya.dev/", ""),
    ).toBeNull();
  });
  it("never sends when disabled, retries transient failure, and removes context after successful attachment", async () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(Error("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await sendAcquisition(false, "https://api.dosya.dev");
    expect(fetcher).not.toHaveBeenCalled();
    await sendAcquisition(true, "https://api.dosya.dev");
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
    await sendAcquisition(true, "https://api.dosya.dev");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://api.dosya.dev/api/me/acquisition",
      expect.objectContaining({
        credentials: "include",
        body: JSON.stringify(c),
      }),
    );
  });
});

it("does not attach an app-origin pending context after consent is withdrawn on the public origin", async () => {
  // The two origins have separate sessionStorage but share this consent preference cookie.
  document.cookie = "dosya_acquisition_consent=1;path=/";
  window.history.replaceState(
    {},
    "",
    `/sign-up?acq=${encodeURIComponent(JSON.stringify(c))}`,
  );
  consumeAcquisition(true);
  expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
  document.cookie = "dosya_acquisition_consent=0;path=/";
  window.history.replaceState({}, "", "/sign-up?ref=friend");
  consumeAcquisition(true);
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 204 }));
  await sendAcquisition(true, "https://api.dosya.dev");
  expect(fetcher).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  expect(window.location.search).toBe("?ref=friend");
});
it("checks withdrawal again at dashboard attachment, even without revisiting signup", async () => {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  document.cookie = "dosya_acquisition_consent=0;path=/";
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 204 }));
  await sendAcquisition(true, "https://api.dosya.dev");
  expect(fetcher).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
});

describe("v2 observed AI-site referrers", () => {
  it.each([
    "https://chatgpt.com/c/private?prompt=secret",
    "https://claude.ai/chat/private",
    "https://perplexity.ai/search/private",
    "https://www.perplexity.ai/search/private",
  ])(
    "classifies exact origin %s without retaining paths or prompts",
    (referrer) => {
      const result = capturePublicContext(
        true,
        true,
        "https://dosya.dev/developer/s3/?utm_source=untrusted#private",
        referrer,
      );
      expect(result).toEqual({
        v: 2,
        landing_group: "developer",
        source_group: "ai_referrer",
        captured_at: now,
      });
      expect(sessionStorage.getItem(STORAGE_KEY)).not.toMatch(
        /private|secret|prompt|utm_|chatgpt|claude|perplexity/,
      );
    },
  );
  it.each([
    "https://chatgpt.com.evil.test",
    "https://chatgpt.com@evil.test",
    "https://sub.claude.ai",
    "https://www.chatgpt.com",
    "https://www.claude.ai",
    "http://chatgpt.com",
    "https://chatgpt.com:8443",
    "ftp://claude.ai",
    "https://help.openai.com",
    "https://claude.com",
    "https://evil.test/?ref=chatgpt.com",
  ])("does not infer AI from %s", (referrer) => {
    expect(
      capturePublicContext(true, true, "https://dosya.dev/", referrer)
        ?.source_group,
    ).not.toBe("ai_referrer");
  });
  it("keeps missing refs, Google AI ambiguity and tag-only claims separate", () => {
    expect(
      capturePublicContext(true, true, "https://dosya.dev/", ""),
    ).toMatchObject({ v: 2, source_group: "direct_or_unknown" });
    sessionStorage.clear();
    expect(
      capturePublicContext(
        true,
        true,
        "https://dosya.dev/?utm_source=chatgpt.com",
        "",
      ),
    ).toMatchObject({ source_group: "other_external" });
    sessionStorage.clear();
    expect(
      capturePublicContext(
        true,
        true,
        "https://dosya.dev/",
        "https://www.google.com/search?udm=50",
      ),
    ).toMatchObject({ source_group: "search_referrer" });
  });
  it("preserves v1 first touch and rejects unversioned AI or raw metadata", () => {
    const legacy = { ...c, v: 1 };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    expect(
      capturePublicContext(
        true,
        true,
        "https://dosya.dev/",
        "https://chatgpt.com/",
      ),
    ).toEqual(legacy);
    expect(
      parseContext({ ...legacy, source_group: "ai_referrer" }, now),
    ).toBeNull();
    expect(
      parseContext({ ...legacy, v: 2, source_group: "ai_referrer" }, now),
    ).not.toBeNull();
    expect(
      parseContext(
        {
          ...legacy,
          v: 2,
          source_group: "ai_referrer",
          referrer: "https://chatgpt.com/private",
        },
        now,
      ),
    ).toBeNull();
  });
  it("hands off and sends only the bounded v2 category with current consent", async () => {
    const context = capturePublicContext(
      true,
      true,
      "https://dosya.dev/",
      "https://chatgpt.com/private?prompt=secret",
    );
    document.body.innerHTML =
      '<a href="https://app.dosya.dev/sign-up">Join</a>';
    decorateSignupLinks(context, "https://app.dosya.dev");
    const target = new URL(document.querySelector("a")!.href);
    expect(target.href).not.toMatch(/secret|prompt|private/);
    sessionStorage.clear();
    window.history.replaceState({}, "", `/sign-up${target.search}`);
    consumeAcquisition(true);
    expect(location.search).toBe("");
    const send = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    await sendAcquisition(true, "https://api.dosya.dev");
    expect(
      JSON.parse((send.mock.calls[0][1] as RequestInit).body as string),
    ).toEqual({
      v: 2,
      landing_group: "home",
      source_group: "ai_referrer",
      captured_at: now,
    });
  });
});

it("does not treat an opaque blob URL as an observed HTTPS AI page", () => {
  expect(
    capturePublicContext(
      true,
      true,
      "https://dosya.dev/",
      "blob:https://chatgpt.com/private",
    )?.source_group,
  ).not.toBe("ai_referrer");
});
it.each([
  ["doNotTrack", "1"],
  ["globalPrivacyControl", true],
])(
  "respects %s for AI capture and pending transmission",
  async (property, value) => {
    const previous = Object.getOwnPropertyDescriptor(navigator, property);
    Object.defineProperty(navigator, property, { value, configurable: true });
    try {
      expect(
        capturePublicContext(
          true,
          true,
          "https://dosya.dev/",
          "https://chatgpt.com/",
        ),
      ).toBeNull();
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...c, v: 2, source_group: "ai_referrer" }),
      );
      const send = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 204 }));
      await sendAcquisition(true, "https://api.dosya.dev");
      expect(send).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    } finally {
      if (previous) Object.defineProperty(navigator, property, previous);
      else delete (navigator as unknown as Record<string, unknown>)[property];
    }
  },
);
