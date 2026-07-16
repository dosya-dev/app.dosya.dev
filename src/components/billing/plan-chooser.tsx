import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { AlertTriangle, X } from "lucide-react";
import {
    getCatalog, startCheckout, updateSubscription, validateCoupon,
    type Catalog, type CartPayload, type CouponInfo,
} from "@/api/billing";
import { apiErrorMessage } from "@/api/client";
import { computeCart, formatCents, formatBytes, type CartState } from "@/lib/billing/cart-math";
import { PlanSelector } from "./plan-selector";
import { AddonRow } from "./addon-row";

/**
 * Inline (in-page) plan/add-on chooser — the same cart flow the SubscriptionModal
 * used, but rendered as a Card directly on the billing page instead of a dialog.
 * Mounted only while open, so it initializes fresh from `initial` each time.
 */
export function PlanChooser({ hasSubscription, initial, usedBytes, onUpdated, onClose }: {
    hasSubscription: boolean;
    initial: { interval: "month" | "year"; planId: string; addonQty: Record<string, number> };
    usedBytes: number;
    onUpdated: () => void;
    onClose: () => void;
}) {
    const [catalog, setCatalog] = useState<Catalog | null>(null);
    const [state, setState] = useState<CartState>({ ...initial, coupon: null });
    const [codeInput, setCodeInput] = useState("");
    const [couponError, setCouponError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        getCatalog().then(setCatalog).catch(() => setError("Failed to load plans"));
    }, []);

    const selectedPlan = catalog?.plans.find((p) => p.id === state.planId);
    const isPaid = selectedPlan?.price_monthly ?? 0;
    // Interval-change guard: the selected plan may not be sold on the chosen interval.
    const planAvailableAtInterval = !selectedPlan || selectedPlan.price_monthly === 0
        || (state.interval === "year" ? selectedPlan.has_yearly : selectedPlan.has_monthly);
    const cart = catalog ? computeCart(state, catalog) : null;
    const downgradeWarning = cart ? cart.effectiveBytes < usedBytes : false;

    const setInterval = (interval: "month" | "year") => setState((s) => ({ ...s, interval }));
    const setPlan = (planId: string) => setState((s) => ({ ...s, planId }));
    const setQty = (id: string, qty: number) => setState((s) => ({ ...s, addonQty: { ...s.addonQty, [id]: qty } }));

    const applyCoupon = async () => {
        setCouponError(null);
        try { const info = await validateCoupon(codeInput.trim()); setState((s) => ({ ...s, coupon: info as CouponInfo })); }
        catch (e) { setState((s) => ({ ...s, coupon: null })); setCouponError(apiErrorMessage(e, "Invalid code")); }
    };

    const submit = async () => {
        if (!catalog) return;
        setSubmitting(true); setError(null);
        const payload: CartPayload = {
            interval: state.interval, plan_id: state.planId,
            addons: Object.entries(state.addonQty)
                .filter(([id, q]) => q > 0 && catalog.addons.some((a) => a.id === id))
                .map(([id, qty]) => ({ id, qty })),
            promo_code: state.coupon?.code,
        };
        try {
            if (hasSubscription) { await updateSubscription(payload); onUpdated(); onClose(); }
            else { const { url } = await startCheckout(payload); window.location.href = url; }
        } catch (e) { setError(apiErrorMessage(e)); setSubmitting(false); }
    };

    return (
        <Card className="p-5 mb-5">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold">{hasSubscription ? "Change your plan" : "Choose your plan"}</h2>
                <button type="button" onClick={onClose} className="size-7 rounded flex items-center justify-center hover:bg-muted" aria-label="Close">
                    <X className="size-4 text-muted-foreground" />
                </button>
            </div>

            {!catalog ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Loading plans…</p>
            ) : (
                <div className="space-y-4">
                    {/* Interval toggle — governs the whole cart (plan + add-ons) */}
                    <div className="flex items-center justify-center gap-1 rounded-lg bg-muted p-1 text-sm">
                        {(["month", "year"] as const).map((iv) => (
                            <button key={iv} type="button" onClick={() => setInterval(iv)}
                                className={`flex-1 rounded-md px-3 py-1.5 ${state.interval === iv ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}>
                                {iv === "month" ? "Monthly" : "Annual"}{iv === "year" && catalog.plans.some((p) => p.has_yearly) && <span className="ml-1 text-[10px] text-green-600">save ~17%</span>}
                            </button>
                        ))}
                    </div>

                    <PlanSelector plans={catalog.plans} interval={state.interval} selectedId={state.planId} onSelect={setPlan} />

                    {/* Add-ons */}
                    <div>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">Storage add-ons {isPaid <= 0 && "(select a paid plan first)"}</p>
                        <div className="rounded-lg border px-3">
                            {catalog.addons.map((a) => {
                                const avail = state.interval === "year" ? a.has_yearly : a.has_monthly;
                                return <AddonRow key={a.id} addon={a} interval={state.interval} qty={state.addonQty[a.id] ?? 0}
                                    disabled={isPaid <= 0 || !avail} onChange={(q) => setQty(a.id, q)} />;
                            })}
                        </div>
                    </div>

                    {/* Coupon */}
                    <div className="flex items-end gap-2">
                        <div className="flex-1">
                            <label className="text-xs text-muted-foreground">Promo code</label>
                            <Input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="Enter code" className="h-8" />
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={applyCoupon} disabled={!codeInput.trim()}>Apply</Button>
                    </div>
                    {couponError && <p className="text-xs text-red-600">{couponError}</p>}
                    {state.coupon && <p className="text-xs text-green-600">Code {state.coupon.code} applied.</p>}

                    {/* Cart summary */}
                    {cart && (
                        <div className="rounded-lg bg-muted/50 p-3 text-sm">
                            {cart.lines.map((l, i) => (
                                <div key={i} className="flex justify-between text-muted-foreground"><span>{l.label}</span><span>{formatCents(l.totalCents)}</span></div>
                            ))}
                            {cart.discountCents > 0 && <div className="flex justify-between text-green-600"><span>Discount</span><span>−{formatCents(cart.discountCents)}</span></div>}
                            <div className="mt-2 flex justify-between border-t pt-2 font-semibold">
                                <span>Total</span><span>{formatCents(cart.totalCents)}/{state.interval === "year" ? "yr" : "mo"}</span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">New storage: {formatBytes(cart.effectiveBytes)}</p>
                        </div>
                    )}

                    {downgradeWarning && (
                        <div className="flex items-start gap-1.5 text-xs text-amber-600">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                            This is below your current usage ({formatBytes(usedBytes)}). New uploads will be blocked until you free up space; nothing is deleted.
                        </div>
                    )}
                    {!planAvailableAtInterval && (
                        <div className="flex items-start gap-1.5 text-xs text-amber-600">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                            {selectedPlan?.name} isn&apos;t available on {state.interval === "year" ? "annual" : "monthly"} billing. Pick a different plan or switch the interval back.
                        </div>
                    )}
                    {error && <p className="text-xs text-red-600">{error}</p>}

                    <div className="flex justify-end gap-2 pt-1">
                        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
                        <Button size="sm" onClick={submit} disabled={submitting || isPaid <= 0 || !planAvailableAtInterval}>
                            {hasSubscription ? "Update subscription" : "Continue to payment"}
                        </Button>
                    </div>
                </div>
            )}
        </Card>
    );
}
