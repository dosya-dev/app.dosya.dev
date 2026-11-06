import { describe, it, expect } from "vitest";
import { computeCart, formatCents, formatBytes, yearlySavingPct, type CartState } from "@/lib/billing/cart-math";
import type { Catalog } from "@/api/billing";

const GB = 1_073_741_824, TB = 1_099_511_627_776;
const catalog: Catalog = {
    currency: "usd", currencies: ["usd"],
    plans: [
        { id: "free", name: "Free", storage_bytes: 5 * GB, storage_label: "5 GB", price_monthly: 0, price_yearly: 0, price_monthly_label: "Free", price_yearly_label: null, features: [], has_monthly: false, has_yearly: false },
        { id: "pro", name: "Pro", storage_bytes: 1 * TB, storage_label: "1 TB", price_monthly: 1999, price_yearly: 19990, price_monthly_label: "$19.99", price_yearly_label: "$199.90", features: [], has_monthly: true, has_yearly: true },
    ],
    addons: [
        { id: "addon_1tb", name: "+1 TB", storage_bytes: 1 * TB, storage_label: "1 TB", price_monthly: 1500, price_yearly: 15000, price_monthly_label: "$15", price_yearly_label: "$150", max_quantity: 20, has_monthly: true, has_yearly: true },
        { id: "addon_monthly_only", name: "+500 GB", storage_bytes: 500 * GB, storage_label: "500 GB", price_monthly: 800, price_yearly: null, price_monthly_label: "$8", price_yearly_label: null, max_quantity: 10, has_monthly: true, has_yearly: false },
    ],
};

describe("computeCart", () => {
    it("sums plan + add-on × qty at the monthly interval", () => {
        const state: CartState = { currency: "usd", interval: "month", planId: "pro", addonQty: { addon_1tb: 2 }, coupon: null };
        const r = computeCart(state, catalog);
        expect(r.subtotalCents).toBe(1999 + 1500 * 2);
        expect(r.totalCents).toBe(1999 + 1500 * 2);
        expect(r.effectiveBytes).toBe(1 * TB + 2 * TB);
    });

    it("uses yearly prices at the yearly interval", () => {
        const state: CartState = { currency: "usd", interval: "year", planId: "pro", addonQty: { addon_1tb: 1 }, coupon: null };
        expect(computeCart(state, catalog).subtotalCents).toBe(19990 + 15000);
    });

    it("applies a percent coupon to the subtotal", () => {
        const state: CartState = { currency: "usd", interval: "month", planId: "pro", addonQty: {}, coupon: { code: "HALF", type: "percent", value: 50, currency: null, duration: "once", duration_in_months: null } };
        const r = computeCart(state, catalog);
        expect(r.discountCents).toBe(Math.round(1999 * 0.5));
        expect(r.totalCents).toBe(1999 - Math.round(1999 * 0.5));
    });

    it("applies a fixed-amount coupon, clamped at zero", () => {
        const state: CartState = { currency: "usd", interval: "month", planId: "pro", addonQty: {}, coupon: { code: "BIG", type: "amount", value: 999999, currency: "usd", duration: "once", duration_in_months: null } };
        const r = computeCart(state, catalog);
        expect(r.totalCents).toBe(0);
        expect(r.discountCents).toBe(1999);
    });

    it("drops add-ons not sold at the chosen interval (no $0 lines, no phantom storage)", () => {
        const state: CartState = { currency: "usd", interval: "year", planId: "pro", addonQty: { addon_monthly_only: 2 }, coupon: null };
        const r = computeCart(state, catalog);
        expect(r.lines).toHaveLength(1); // plan only
        expect(r.subtotalCents).toBe(19990);
        expect(r.effectiveBytes).toBe(1 * TB);
    });

    it("ignores add-on quantities when the free plan is selected", () => {
        const state: CartState = { currency: "usd", interval: "month", planId: "free", addonQty: { addon_1tb: 3 }, coupon: null };
        const r = computeCart(state, catalog);
        expect(r.subtotalCents).toBe(0);
        expect(r.effectiveBytes).toBe(5 * GB);
    });
});

describe("coupon currency", () => {
    const base: CartState = { currency: "usd", interval: "month", planId: "pro", addonQty: {}, coupon: null };

    it("ignores an amount coupon in another currency", () => {
        const r = computeCart({ ...base, currency: "eur", coupon: { code: "X", type: "amount", value: 500, currency: "usd", duration: "once", duration_in_months: null } }, catalog);
        expect(r.discountCents).toBe(0);
        expect(r.totalCents).toBe(1999);
        expect(r.couponCurrencyMismatch).toBe(true);
    });

    it("applies a matching amount coupon and any percent coupon", () => {
        const amount = computeCart({ ...base, currency: "eur", coupon: { code: "E5", type: "amount", value: 500, currency: "eur", duration: "once", duration_in_months: null } }, catalog);
        expect(amount.discountCents).toBe(500);
        expect(amount.couponCurrencyMismatch).toBe(false);
        const percent = computeCart({ ...base, currency: "eur", coupon: { code: "HALF", type: "percent", value: 50, currency: null, duration: "once", duration_in_months: null } }, catalog);
        expect(percent.discountCents).toBe(Math.round(1999 * 0.5));
        expect(percent.couponCurrencyMismatch).toBe(false);
    });

    it("reads a coupon with no currency as dollars", () => {
        const r = computeCart({ ...base, coupon: { code: "D5", type: "amount", value: 500, currency: null, duration: "once", duration_in_months: null } }, catalog);
        expect(r.discountCents).toBe(500);
        expect(r.couponCurrencyMismatch).toBe(false);
    });
});

describe("formatCents / formatBytes", () => {
    it("formats cents as dollars", () => { expect(formatCents(1999)).toBe("$19.99"); expect(formatCents(1500)).toBe("$15"); });
    it("formats euros", () => { expect(formatCents(349, "eur")).toBe("€3.49"); expect(formatCents(1500, "eur")).toBe("€15"); expect(formatCents(1999)).toBe("$19.99"); });
    it("formats bytes with a unit", () => { expect(formatBytes(TB)).toMatch(/TB$/); expect(formatBytes(GB)).toMatch(/GB$/); });
});

describe("yearlySavingPct", () => {
    const plan = (id: string, m: number, y: number | null, has_yearly = true) => ({ id, price_monthly: m, price_yearly: y, has_yearly } as any);
    const plans = [plan("free", 0, 0), plan("starter", 149, 1499), plan("business", 699, 6499), plan("tb4", 1299, 12999)];

    it("is the selected size's own discount, rounded down", () => {
        expect(yearlySavingPct(plans, "starter")).toBe(16);
        expect(yearlySavingPct(plans, "business")).toBe(22);
    });

    it("falls back to the thinnest discount when the selection has none", () => {
        expect(yearlySavingPct(plans, "free")).toBe(16);
        expect(yearlySavingPct(plans)).toBe(16);
    });

    it("is null when nothing is sold yearly", () => {
        expect(yearlySavingPct([plan("starter", 149, 1499, false)])).toBeNull();
    });
});
