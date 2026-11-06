import { fixedNumber, formatNumberWith, sizeUnits } from '@/lib/format-locale';
import { t } from '@/lib/i18n';
import type { Catalog, CatalogPlan, CatalogAddon, CouponInfo, Currency } from "@/api/billing";

export type CartState = {
    currency: Currency;
    interval: "month" | "year";
    planId: string;
    addonQty: Record<string, number>;
    coupon: CouponInfo | null;
};

const GB = 1_073_741_824, TB = 1_099_511_627_776, MB = 1_048_576;

const SYMBOL: Record<Currency, string> = { usd: "$", eur: "€" };

/** Whole amounts drop the decimals ($4, €15); the symbol leads for both currencies. */
export function formatCents(cents: number, currency: Currency = "usd"): string {
    const d = cents / 100;
    const whole = d % 1 === 0;
    return (SYMBOL[currency] ?? SYMBOL.usd) + d.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}

export function isCurrency(v: unknown): v is Currency {
    return v === "usd" || v === "eur";
}

/** The visitor's last currency pick, for the next catalog load before a first subscription. */
export const CURRENCY_STORAGE_KEY = "dosya_currency";

export function storedCurrency(): Currency | undefined {
    try {
        const v = localStorage.getItem(CURRENCY_STORAGE_KEY);
        return isCurrency(v) ? v : undefined;
    } catch { return undefined; }
}

export function rememberCurrency(c: Currency): void {
    try { localStorage.setItem(CURRENCY_STORAGE_KEY, c); } catch { /* storage blocked: the pick lasts this visit only */ }
}

/**
 * Storage in gigabytes, thousands separated: "2,048 GB" rather than "2 TB".
 * A terabyte figure reads as a small number, and these pages are about how much
 * space someone has. Under a gigabyte it falls back to formatBytes so a 500 MB
 * figure is not written as "0 GB".
 */
export function formatGigabytes(bytes: number): string {
    if (bytes < GB) return formatBytes(bytes);
    return `${gigabyteFigure(bytes)} ${sizeUnits().GB}`;
}

/**
 * The number part of formatGigabytes, without the unit: whole GB, grouped the
 * same way. For "184 of 200 GB", so both figures in one sentence agree.
 */
export function gigabyteFigure(bytes: number): string {
    return formatNumberWith(Math.round(bytes / GB), undefined, 'en-US');
}

export function formatBytes(bytes: number): string {
    const u = sizeUnits();
    if (bytes >= TB) return `${fixedNumber(bytes / TB, bytes % TB === 0 ? 0 : 1)} ${u.TB}`;
    if (bytes >= GB) return `${fixedNumber(bytes / GB, 0)} ${u.GB}`;
    return `${fixedNumber(bytes / MB, 0)} ${u.MB}`;
}

function planPrice(plan: CatalogPlan, interval: "month" | "year"): number {
    return interval === "year" ? (plan.price_yearly ?? 0) : plan.price_monthly;
}
function addonPrice(a: CatalogAddon, interval: "month" | "year"): number {
    return interval === "year" ? (a.price_yearly ?? 0) : a.price_monthly;
}
/**
 * Whole percent a year costs less than twelve monthly payments, for the Yearly
 * badge. The selected size's own discount when it has one, otherwise the
 * thinnest across the sizes sold yearly. Rounded down so the badge never
 * promises more than the bill gives; null when nothing is sold yearly.
 */
export function yearlySavingPct(plans: CatalogPlan[], selectedId?: string): number | null {
    const pct = (p: CatalogPlan) => Math.floor((1 - (p.price_yearly ?? 0) / (p.price_monthly * 12)) * 100);
    const yearly = plans.filter((p) => p.price_monthly > 0 && p.has_yearly && p.price_yearly != null);
    const selected = yearly.find((p) => p.id === selectedId);
    if (selected) return pct(selected);
    return yearly.length ? Math.min(...yearly.map(pct)) : null;
}

export function addonAvailableAt(a: CatalogAddon, interval: "month" | "year"): boolean {
    return interval === "year" ? a.has_yearly : a.has_monthly;
}

export function computeCart(state: CartState, catalog: Catalog) {
    const plan = catalog.plans.find((p) => p.id === state.planId);
    const isPaid = !!plan && plan.price_monthly > 0;
    const lines: { label: string; qty: number; unitCents: number; totalCents: number }[] = [];
    let subtotalCents = 0;
    let effectiveBytes = plan ? plan.storage_bytes : 0;

    if (plan && isPaid) {
        const unit = planPrice(plan, state.interval);
        lines.push({ label: t('common.label.plannamePlan', { planName: plan.name }), qty: 1, unitCents: unit, totalCents: unit });
        subtotalCents += unit;

        for (const addon of catalog.addons) {
            const qty = state.addonQty[addon.id] ?? 0;
            if (qty <= 0) continue;
            // An add-on not sold at this interval is dropped from the cart entirely -
            // pricing it at $0 (and still counting its storage) would misstate the order.
            if (!addonAvailableAt(addon, state.interval)) continue;
            const unitA = addonPrice(addon, state.interval);
            lines.push({ label: `${addon.name} × ${qty}`, qty, unitCents: unitA, totalCents: unitA * qty });
            subtotalCents += unitA * qty;
            effectiveBytes += addon.storage_bytes * qty;
        }
    }

    // An amount code only discounts a cart in its own currency (a code without
    // one is a dollar code); checkout refuses the rest, so the total never counts it.
    const couponCurrencyMismatch = state.coupon?.type === "amount" && (state.coupon.currency ?? "usd").toLowerCase() !== state.currency;
    let discountCents = 0;
    if (state.coupon && !couponCurrencyMismatch) {
        discountCents = state.coupon.type === "percent"
            ? Math.round(subtotalCents * (state.coupon.value / 100))
            : Math.min(state.coupon.value, subtotalCents);
    }

    return { lines, subtotalCents, discountCents, totalCents: Math.max(0, subtotalCents - discountCents), effectiveBytes, couponCurrencyMismatch };
}

/**
 * Unix seconds when a running trial ends, else null. Keyed off `trial_end`, not
 * the status: Stripe's $0 first invoice makes the server write 'active' during
 * a trial, so `status === 'trialing'` is never what the page sees.
 */
export function activeTrialEnd(sub: { trial_end?: number | null } | null | undefined): number | null {
  const end = sub?.trial_end;
  return end != null && end * 1000 > Date.now() ? end : null;
}
