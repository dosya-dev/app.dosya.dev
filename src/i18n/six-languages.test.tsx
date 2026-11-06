/**
 * European Portuguese, Ukrainian, Serbian, Russian, Latin American Spanish and
 * Canadian French: all left to right. The login page renders in Russian with no
 * leftover English, and each language is wired into the locale table.
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
const ru = (await import("@/i18n/messages/ru.json")).default as Record<string, string>;

const SIX = [
  ["pt-PT", "Português (Portugal)"],
  ["uk", "Українська"],
  ["sr", "Српски"],
  ["ru", "Русский"],
  ["es-419", "Español (Latinoamérica)"],
  ["fr-CA", "Français (Canada)"],
] as const;

let shown: Rendered | null = null;
afterEach(() => {
  shown?.unmount();
  shown = null;
});

describe("the six regional and Slavic languages", () => {
  it("are shipped, labelled in their own names, and left to right", () => {
    for (const [code, label] of SIX) {
      expect(isLocale(code), code).toBe(true);
      expect(LOCALES as readonly string[]).toContain(code);
      expect(LOCALE_LABELS[code]).toBe(label);
      expect(localeDir(code)).toBe("ltr");
      expect(intlTag(code)).toBe(code);
    }
  });

  it("sit next to the language they are a variant of", () => {
    const at = (l: string) => (LOCALES as readonly string[]).indexOf(l);
    expect(at("fr-CA")).toBe(at("fr") + 1);
    expect(at("es-419")).toBe(at("es") + 1);
    expect(at("pt-PT")).toBe(at("pt-BR") + 1);
  });

  it("render the login page in Russian with no leftover English", async () => {
    apiMock.mockImplementation(async () => ({ ok: false }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    shown = await renderInLocale(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/login"]}>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>,
      "ru",
    );
    expect(document.documentElement.lang).toBe("ru");
    expect(document.documentElement.dir).toBe("ltr");
    expect(document.body.textContent).toContain(ru["common.heading.welcomeBack"]);
    expect(shown.leftover()).toEqual([]);
  });
});
