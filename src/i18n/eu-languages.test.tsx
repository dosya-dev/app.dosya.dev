/**
 * Bulgarian, Croatian, Slovak, Slovenian, Estonian, Latvian and Lithuanian:
 * all left to right. The login page renders in Bulgarian with no leftover
 * English, and each language is wired into the locale table.
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
const bg = (await import("@/i18n/messages/bg.json")).default as Record<string, string>;

const EU7 = [
  ["bg", "Български"],
  ["hr", "Hrvatski"],
  ["sk", "Slovenčina"],
  ["sl", "Slovenščina"],
  ["et", "Eesti"],
  ["lv", "Latviešu"],
  ["lt", "Lietuvių"],
] as const;

let shown: Rendered | null = null;
afterEach(() => {
  shown?.unmount();
  shown = null;
});

describe("the seven European languages", () => {
  it("are shipped, labelled in their own names, and left to right", () => {
    for (const [code, label] of EU7) {
      expect(isLocale(code), code).toBe(true);
      expect(LOCALES as readonly string[]).toContain(code);
      expect(LOCALE_LABELS[code]).toBe(label);
      expect(localeDir(code)).toBe("ltr");
      expect(intlTag(code)).toBe(code);
    }
  });

  it("render the login page in Bulgarian with no leftover English", async () => {
    apiMock.mockImplementation(async () => ({ ok: false }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    shown = await renderInLocale(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/login"]}>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>,
      "bg",
    );
    expect(document.documentElement.lang).toBe("bg");
    expect(document.documentElement.dir).toBe("ltr");
    expect(document.body.textContent).toContain(bg["common.heading.welcomeBack"]);
    expect(shown.leftover()).toEqual([]);
  });
});
