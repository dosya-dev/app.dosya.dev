import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CouponInfo, Currency } from "@/api/billing";
import { formatBytes, formatCents, type computeCart } from "@/lib/billing/cart-math";
import { richText } from "@/lib/rich-text";
import { useT } from "@/lib/i18n";

type Cart = ReturnType<typeof computeCart>;

/**
 * The right column of the chooser: what the customer is about to pay for,
 * line by line, the total, the notes that apply (yearly per-month figure,
 * new storage, tax, proration or trial), the promo code and the one button.
 */
export function CartReceipt({
    cart, currency, interval, hasSubscription, previewCents, offersTrial, trialEndsOn,
    coupon, couponError, codeInput, onCodeInput, onApplyCoupon,
    submitting, submitDisabled, ctaLabel, onSubmit, children,
}: {
    cart: Cart; currency: Currency; interval: "month" | "year"; hasSubscription: boolean;
    previewCents: number | null; offersTrial: boolean; trialEndsOn: string;
    coupon: CouponInfo | null; couponError: string | null; codeInput: string;
    onCodeInput: (v: string) => void; onApplyCoupon: () => void;
    submitting: boolean; submitDisabled: boolean; ctaLabel: string; onSubmit: () => void;
    /** Warnings that belong beside the button (errors, availability). */
    children?: ReactNode;
}) {
    const t = useT();
    const per = t(interval === "year" ? "billing.label.perYearShort" : "billing.label.perMonthShort");

    return (
        <aside className="border-t bg-background p-5 md:sticky md:top-4 md:self-start md:border-s md:border-t-0" aria-live="polite" data-testid="cart-receipt">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{t("billing.heading.yourNewSubscription")}</p>
            <ul className="mt-2.5 font-mono text-[12.5px]">
                {cart.lines.map((l, i) => (
                    <li key={i} className="flex justify-between gap-2.5 border-b border-dashed py-1.5">
                        <span className="min-w-0 text-muted-foreground">{l.label}</span>
                        <span className="shrink-0 tabular-nums">{formatCents(l.totalCents, currency)}</span>
                    </li>
                ))}
                {cart.discountCents > 0 && (
                    <li className="flex justify-between gap-2.5 border-b border-dashed py-1.5" style={{ color: "var(--brand-text)" }}>
                        <span className="min-w-0">{t("billing.label.discount")}</span>
                        <span className="shrink-0 tabular-nums">−{formatCents(cart.discountCents, currency)}</span>
                    </li>
                )}
            </ul>
            <div className="flex items-baseline justify-between gap-2.5 pt-3">
                <span className="text-xs font-semibold">{t("common.label.total")}</span>
                <span className="font-mono text-2xl font-bold leading-none tracking-[-0.03em] tabular-nums">
                    {formatCents(cart.totalCents, currency)}
                    <span className="ms-0.5 font-sans text-xs font-medium tracking-normal text-muted-foreground">{per}</span>
                </span>
            </div>
            <div className="mt-1.5 space-y-0.5 text-xs leading-relaxed text-muted-foreground">
                {interval === "year" && <p>{t("billing.description.thatIsAmountAMonthChargedOnceAYear", { amount: formatCents(Math.round(cart.totalCents / 12), currency) })}</p>}
                <p>{richText(t("billing.label.newStorageSize", { size: "{size}" }), { size: <b className="font-semibold text-foreground">{formatBytes(cart.effectiveBytes)}</b> })}</p>
                <p>{currency === "eur" ? t("billing.label.pricesIncludeVat") : t("billing.label.taxesCalculatedAtCheckout")}</p>
                {hasSubscription && previewCents != null && <p>{t("billing.label.estimatedNextInvoiceInclProrationPreviewcents", { previewCents: formatCents(previewCents, currency) })}</p>}
                {offersTrial && <p>{t("billing.description.freeFor7DaysThenCarttotalcentsAStateintervalyearSelectTrueYear", { cartTotalCents: formatCents(cart.totalCents, currency), stateIntervalYear: String(interval === "year"), trialEndsOn })}</p>}
            </div>

            <form className="mt-4 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (codeInput.trim()) onApplyCoupon(); }}>
                <Input value={codeInput} onChange={(e) => onCodeInput(e.target.value)} placeholder={t("billing.placeholder.enterCode")} aria-label={t("billing.label.promoCode")} className="h-8 min-w-0 flex-1" />
                <Button type="submit" variant="outline" size="sm" disabled={!codeInput.trim()}>{t("common.apply")}</Button>
            </form>
            {couponError && <p dir="auto" className="mt-1.5 text-xs text-red-600">{couponError}</p>}
            {coupon && (
                <p className="mt-1.5 text-xs text-green-600">
                    {t("billing.description.codeCouponcodeAppliedIsonceIsrepeating", {
                        couponCode: coupon.code,
                        isOnce: coupon.duration === "once" ? "true" : "false",
                        isRepeating: coupon.duration === "repeating" && coupon.duration_in_months ? "true" : "false",
                        couponDuration_in_months: coupon.duration_in_months ?? 0,
                    })}
                </p>
            )}

            {children}

            <div className="mt-4 grid gap-2">
                <Button
                    onClick={onSubmit}
                    disabled={submitting || submitDisabled}
                    className="h-10 w-full justify-center text-sm"
                    style={{ background: "var(--brand)", color: "var(--brand-foreground)" }}
                >
                    {ctaLabel}
                </Button>
                <p className="text-center text-[11px] text-muted-foreground">{t("billing.description.14DayMoneyBackGuaranteeOnEveryPlan")}</p>
            </div>
        </aside>
    );
}
