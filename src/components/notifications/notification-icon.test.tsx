import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NotificationIcon } from "./notification-icon";
import { KNOWN_ICON_KEYS, NOTIFICATION_ICON_COMPONENTS } from "./notification-icon-map";

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); root = null; container?.remove(); });

function draw(props: Parameters<typeof NotificationIcon>[0]): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<NotificationIcon {...props} />));
  return container.querySelector("[data-icon]") as HTMLElement;
}

describe("NotificationIcon", () => {
  it("has a component for every key in the generated list, and nothing else", () => {
    expect(Object.keys(NOTIFICATION_ICON_COMPONENTS).sort()).toEqual([...KNOWN_ICON_KEYS].sort());
  });

  it("draws the key the row carries as an svg, not as text", () => {
    const el = draw({ icon: "credit-card", category: "security", priority: "normal" });
    expect(el.dataset.icon).toBe("credit-card");
    expect(el.querySelector("svg")).not.toBeNull();
    expect(el.textContent).toBe("");
  });

  it("falls back to the group icon for a row that still carries an emoji", () => {
    expect(draw({ icon: "🔐", category: "security", priority: "normal" }).dataset.icon).toBe("shield");
  });

  it("falls back to the bell when neither the icon nor the group is known", () => {
    expect(draw({ icon: null, category: "admin_message", priority: "normal" }).dataset.icon).toBe("bell");
  });

  it("tints by priority, and lets read state show only on normal rows", () => {
    expect(draw({ icon: "credit-card", category: "billing", priority: "critical" }).className).toContain("text-destructive");
    expect(draw({ icon: "user-plus", category: "team", priority: "important" }).className).toContain("text-warning");
    expect(draw({ icon: "upload", category: "files", priority: "normal", unread: true }).className).toContain("text-foreground");
    expect(draw({ icon: "upload", category: "files", priority: "normal", unread: false }).className).toContain("text-muted-foreground");
  });

  it("is decorative: hidden from assistive tech, the title carries the meaning", () => {
    expect(draw({ icon: "bell", category: null, priority: null }).getAttribute("aria-hidden")).toBe("true");
  });
});
