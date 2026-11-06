/**
 * Traditional Chinese (Simplified Chinese, Korean, Thai and Japanese join the
 * shipped list when their catalogs are complete). Left to right. The login
 * page renders in zh-Hant with no leftover English, the exact script tag is the
 * <html lang>, and the picker shows each candidate in its own name.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { intlTag, isLocale, localeDir, LOCALE_LABELS, LOCALES } from "@/i18n/locales";
import { renderInLocale, type Rendered } from "../../tests/helpers/i18n-sweep";

const apiMock = vi.fn();
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, API_BASE: "", api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock("@/components/turnstile-widget", () => ({ TurnstileWidget: () => <div data-testid="turnstile" /> }));
vi.mock("@/lib/logout", () => ({ logoutAndRedirect: () => {}, logoutAndRedirectTo: () => {} }));

const { default: LoginPage } = await import("@/pages/login");
const zh = (await import("@/i18n/messages/zh-Hant.json")).default as Record<string, string>;

const SHIPPED_NOW = [["zh-Hant", "繁體中文"]] as const;

let shown: Rendered | null = null;
afterEach(() => {
  shown?.unmount();
  shown = null;
});

describe("Traditional Chinese", () => {
  it("are shipped, labelled in their own names, and left to right", () => {
    for (const [code, label] of SHIPPED_NOW) {
      expect(isLocale(code), code).toBe(true);
      expect(LOCALES as readonly string[]).toContain(code);
      expect(LOCALE_LABELS[code]).toBe(label);
      expect(localeDir(code)).toBe("ltr");
      expect(intlTag(code)).toBe(code);
    }
  });

  it("render the login page in zh-Hant with no leftover English", async () => {
    apiMock.mockImplementation(async () => ({ ok: false }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    shown = await renderInLocale(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/login"]}>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>,
      "zh-Hant",
    );
    expect(document.documentElement.lang).toBe("zh-Hant");
    expect(document.documentElement.dir).toBe("ltr");
    expect(document.body.textContent).toContain(zh["common.heading.welcomeBack"]);
    expect(shown.leftover()).toEqual([]);
  });
});
