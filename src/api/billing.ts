import { api } from "@/api/client";

export type CatalogPlan = {
    id: string; name: string;
    storage_bytes: number; storage_label: string;
    price_monthly: number; price_yearly: number | null;
    price_monthly_label: string; price_yearly_label: string | null;
    features: string[]; has_monthly: boolean; has_yearly: boolean;
};
export type CatalogAddon = {
    id: string; name: string;
    storage_bytes: number; storage_label: string;
    price_monthly: number; price_yearly: number | null;
    price_monthly_label: string; price_yearly_label: string | null;
    max_quantity: number; has_monthly: boolean; has_yearly: boolean;
};
export type Catalog = { plans: CatalogPlan[]; addons: CatalogAddon[] };

export type SubscriptionItemView = {
    kind: "plan" | "addon" | "custom"; ref_id: string; quantity: number;
    storage_bytes: number; total_bytes: number; total_label: string; interval: "month" | "year";
};
export type BillingStatus = {
    plan: { id: string; name: string; storage_bytes: number; storage_label: string; price_monthly: number };
    usage: { used_bytes: number; used_label: string; limit_bytes: number; pct: number };
    subscription: { status: string | null; current_period_end: number | null; has_subscription: boolean; cancel_at_period_end: boolean; grace_period_end: number | null };
    interval: "month" | "year";
    items: SubscriptionItemView[];
    invoices: { id: string; period_start: number; period_end: number; amount: number; status: string; pdf_url: string | null }[];
    portal_url?: string | null;
};

export type CartPayload = { interval: "month" | "year"; plan_id: string; addons: { id: string; qty: number }[]; promo_code?: string };
export type CouponInfo = { code: string; type: "percent" | "amount"; value: number; currency: string | null; duration: string; duration_in_months: number | null };

export const getCatalog = () => api<{ ok: true } & Catalog>("/api/billing/catalog");
export const getBillingStatus = () => api<{ ok: true } & BillingStatus>("/api/billing/status");

export const startCheckout = (cart: CartPayload) =>
    api<{ ok: true; url: string }>("/api/billing/checkout", { method: "POST", body: JSON.stringify(cart) });
export const updateSubscription = (cart: CartPayload) =>
    api<{ ok: true }>("/api/billing/subscription", { method: "POST", body: JSON.stringify(cart) });
export const previewSubscription = (cart: CartPayload) =>
    api<{ ok: true; amount_due: number; currency: string }>("/api/billing/preview", { method: "POST", body: JSON.stringify(cart) });
export const validateCoupon = (code: string) =>
    api<{ ok: true } & CouponInfo>("/api/billing/coupon/validate", { method: "POST", body: JSON.stringify({ code }) });
