import type { Catalog, CatalogPlan, CatalogAddon, CouponInfo } from "@/api/billing";

export type CartState = {
    interval: "month" | "year";
    planId: string;
    addonQty: Record<string, number>;
    coupon: CouponInfo | null;
};

const GB = 1_073_741_824, TB = 1_099_511_627_776, MB = 1_048_576;

export function formatCents(cents: number): string {
    const d = cents / 100;
    return d % 1 === 0 ? `$${d.toFixed(0)}` : `$${d.toFixed(2)}`;
}

export function formatBytes(bytes: number): string {
    if (bytes >= TB) return `${(bytes / TB).toFixed(bytes % TB === 0 ? 0 : 1)} TB`;
    if (bytes >= GB) return `${(bytes / GB).toFixed(0)} GB`;
    return `${(bytes / MB).toFixed(0)} MB`;
}

function planPrice(plan: CatalogPlan, interval: "month" | "year"): number {
    return interval === "year" ? (plan.price_yearly ?? 0) : plan.price_monthly;
}
function addonPrice(a: CatalogAddon, interval: "month" | "year"): number {
    return interval === "year" ? (a.price_yearly ?? 0) : a.price_monthly;
}

export function computeCart(state: CartState, catalog: Catalog) {
    const plan = catalog.plans.find((p) => p.id === state.planId);
    const isPaid = !!plan && plan.price_monthly > 0;
    const lines: { label: string; qty: number; unitCents: number; totalCents: number }[] = [];
    let subtotalCents = 0;
    let effectiveBytes = plan ? plan.storage_bytes : 0;

    if (plan && isPaid) {
        const unit = planPrice(plan, state.interval);
        lines.push({ label: `${plan.name} plan`, qty: 1, unitCents: unit, totalCents: unit });
        subtotalCents += unit;

        for (const addon of catalog.addons) {
            const qty = state.addonQty[addon.id] ?? 0;
            if (qty <= 0) continue;
            const unitA = addonPrice(addon, state.interval);
            lines.push({ label: `${addon.name} × ${qty}`, qty, unitCents: unitA, totalCents: unitA * qty });
            subtotalCents += unitA * qty;
            effectiveBytes += addon.storage_bytes * qty;
        }
    }

    let discountCents = 0;
    if (state.coupon) {
        discountCents = state.coupon.type === "percent"
            ? Math.round(subtotalCents * (state.coupon.value / 100))
            : Math.min(state.coupon.value, subtotalCents);
    }

    return { lines, subtotalCents, discountCents, totalCents: Math.max(0, subtotalCents - discountCents), effectiveBytes };
}
