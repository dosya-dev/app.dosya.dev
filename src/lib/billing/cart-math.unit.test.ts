import { describe, it, expect } from "vitest";
import { computeCart, formatCents, formatBytes, type CartState } from "@/lib/billing/cart-math";
import type { Catalog } from "@/api/billing";

const GB = 1_073_741_824, TB = 1_099_511_627_776;
const catalog: Catalog = {
    plans: [
        { id: "free", name: "Free", storage_bytes: 5 * GB, storage_label: "5 GB", price_monthly: 0, price_yearly: 0, price_monthly_label: "Free", price_yearly_label: null, features: [], has_monthly: false, has_yearly: false },
        { id: "pro", name: "Pro", storage_bytes: 1 * TB, storage_label: "1 TB", price_monthly: 1999, price_yearly: 19990, price_monthly_label: "$19.99", price_yearly_label: "$199.90", features: [], has_monthly: true, has_yearly: true },
    ],
    addons: [
        { id: "addon_1tb", name: "+1 TB", storage_bytes: 1 * TB, storage_label: "1 TB", price_monthly: 1500, price_yearly: 15000, price_monthly_label: "$15", price_yearly_label: "$150", max_quantity: 20, has_monthly: true, has_yearly: true },
    ],
};

describe("computeCart", () => {
    it("sums plan + add-on × qty at the monthly interval", () => {
        const state: CartState = { interval: "month", planId: "pro", addonQty: { addon_1tb: 2 }, coupon: null };
        const r = computeCart(state, catalog);
        expect(r.subtotalCents).toBe(1999 + 1500 * 2);
        expect(r.totalCents).toBe(1999 + 1500 * 2);
        expect(r.effectiveBytes).toBe(1 * TB + 2 * TB);
    });

    it("uses yearly prices at the yearly interval", () => {
        const state: CartState = { interval: "year", planId: "pro", addonQty: { addon_1tb: 1 }, coupon: null };
        expect(computeCart(state, catalog).subtotalCents).toBe(19990 + 15000);
    });

    it("applies a percent coupon to the subtotal", () => {
        const state: CartState = { interval: "month", planId: "pro", addonQty: {}, coupon: { code: "HALF", type: "percent", value: 50, currency: null, duration: "once", duration_in_months: null } };
        const r = computeCart(state, catalog);
        expect(r.discountCents).toBe(Math.round(1999 * 0.5));
        expect(r.totalCents).toBe(1999 - Math.round(1999 * 0.5));
    });

    it("applies a fixed-amount coupon, clamped at zero", () => {
        const state: CartState = { interval: "month", planId: "pro", addonQty: {}, coupon: { code: "BIG", type: "amount", value: 999999, currency: "usd", duration: "once", duration_in_months: null } };
        const r = computeCart(state, catalog);
        expect(r.totalCents).toBe(0);
        expect(r.discountCents).toBe(1999);
    });

    it("ignores add-on quantities when the free plan is selected", () => {
        const state: CartState = { interval: "month", planId: "free", addonQty: { addon_1tb: 3 }, coupon: null };
        const r = computeCart(state, catalog);
        expect(r.subtotalCents).toBe(0);
        expect(r.effectiveBytes).toBe(5 * GB);
    });
});

describe("formatCents / formatBytes", () => {
    it("formats cents as dollars", () => { expect(formatCents(1999)).toBe("$19.99"); expect(formatCents(1500)).toBe("$15"); });
    it("formats bytes with a unit", () => { expect(formatBytes(TB)).toMatch(/TB$/); expect(formatBytes(GB)).toMatch(/GB$/); });
});
