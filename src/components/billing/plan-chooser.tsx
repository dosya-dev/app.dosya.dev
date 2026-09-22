import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { AlertTriangle, X } from "lucide-react";
import {
    getCatalog, startCheckout, updateSubscription, previewSubscription, validateCoupon,
    type Catalog, type CartPayload, type CouponInfo,
} from "@/api/billing";
import { apiErrorMessage } from "@/api/client";
import { computeCart, formatCents, formatBytes, addonAvailableAt, type CartState } from "@/lib/billing/cart-math";
import { rememberPlanChange, rememberStorageBeforePurchase } from "@/lib/checkout-return";
import { PlanSelector } from "./plan-selector";
import { AddonRow } from "./addon-row";

/**
 * Inline (in-page) plan/add-on chooser - the same cart flow the SubscriptionModal
 * used, but rendered as a Card directly on the billing page instead of a dialog.
 * Mounted only while open, so it initializes fresh from `initial` each time.
 */
export function PlanChooser({ hasSubscription, initial, usedBytes, limitBytes, currentPlanId, mode = "plan", onUpdated, onClose }: {
    hasSubscription: boolean;
    initial: { interval: "month" | "year"; planId: string; addonQty: Record<string, number> };
    usedBytes: number;
    /** Storage limit right now, so the thank-you page can show what the purchase adds. */
    limitBytes?: number;
    /** The plan the account is on, so a smaller pick can be named as a replacement. */
    currentPlanId?: string;
    /** "addons" hides the plan cards: the entry point was Add storage, not Change plan. */
    mode?: "plan" | "addons";
    onUpdated: () => void;
    onClose: () => void;
}) {
    const [catalog, setCatalog] = useState<Catalog | null>(null);
    const [state, setState] = useState<CartState>({ ...initial, coupon: null });
    const [codeInput, setCodeInput] = useState("");
    const [couponError, setCouponError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmedDowngrade, setConfirmedDowngrade] = useState(false);

    useEffect(() => {
        getCatalog().then(setCatalog).catch(() => setError("Failed to load plans"));
    }, []);

    const selectedPlan = catalog?.plans.find((p) => p.id === state.planId);
    const isPaid = selectedPlan?.price_monthly ?? 0;
    // Interval-change guard: the selected plan may not be sold on the chosen interval.
    const planAvailableAtInterval = !selectedPlan || selectedPlan.price_monthly === 0
        || (state.interval === "year" ? selectedPlan.has_yearly : selectedPlan.has_monthly);
    const cart = catalog ? computeCart(state, catalog) : null;
    const currentPlan = catalog?.plans.find((p) => p.id === currentPlanId);
    // A downgrade is about the PLAN, not the cart total: keeping a 100 GB add-on
    // does not make swapping Plus for Starter a smaller loss. The plan cards are
    // labelled by size and sit next to a 100 GB add-on, so "add 100 GB" and
    // "replace my plan with the 100 GB one" are one click apart.
    const isDowngrade = !!currentPlan && !!selectedPlan && selectedPlan.storage_bytes < currentPlan.storage_bytes;
    const downgradeWarning = cart ? cart.effectiveBytes < usedBytes : false;
    // Selected add-ons the chosen interval doesn't sell - dropped from the cart, warn about them.
    const droppedAddons = catalog
        ? catalog.addons.filter((a) => (state.addonQty[a.id] ?? 0) > 0 && !addonAvailableAt(a, state.interval))
        : [];

    // A fresh pick has to be confirmed again.
    useEffect(() => { setConfirmedDowngrade(false); }, [state.planId]);

    const setInterval = (interval: "month" | "year") => setState((s) => ({ ...s, interval }));
    const setPlan = (planId: string) => setState((s) => ({ ...s, planId }));
    const setQty = (id: string, qty: number) => setState((s) => ({ ...s, addonQty: { ...s.addonQty, [id]: qty } }));

    const buildPayload = (cat: Catalog): CartPayload => ({
        interval: state.interval, plan_id: state.planId,
        addons: Object.entries(state.addonQty)
            .filter(([id, q]) => {
                const a = cat.addons.find((x) => x.id === id);
                return q > 0 && !!a && addonAvailableAt(a, state.interval);
            })
            .map(([id, qty]) => ({ id, qty })),
        promo_code: state.coupon?.code,
    });

    // Proration preview for existing subscribers: what the next invoice looks like
    // with this cart applied (prorations land there under create_prorations).
    const [previewCents, setPreviewCents] = useState<number | null>(null);
    const previewSeq = useRef(0);
    useEffect(() => {
        if (!hasSubscription || !catalog) return;
        const seq = ++previewSeq.current;
        setPreviewCents(null);
        const plan = catalog.plans.find((p) => p.id === state.planId);
        const planOk = !!plan && plan.price_monthly > 0
            && (state.interval === "year" ? plan.has_yearly : plan.has_monthly);
        if (!planOk) return;
        const t = setTimeout(() => {
            previewSubscription(buildPayload(catalog))
                .then((r) => { if (previewSeq.current === seq) setPreviewCents(r.amount_due); })
                .catch(() => { if (previewSeq.current === seq) setPreviewCents(null); });
        }, 400);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasSubscription, catalog, state.planId, state.interval, state.addonQty]);

    const applyCoupon = async () => {
        setCouponError(null);
        try { const info = await validateCoupon(codeInput.trim()); setState((s) => ({ ...s, coupon: info as CouponInfo })); }
        catch (e) { setState((s) => ({ ...s, coupon: null })); setCouponError(apiErrorMessage(e, "Invalid code")); }
    };

    const submit = async () => {
        if (!catalog) return;
        setSubmitting(true); setError(null);
        const payload = buildPayload(catalog);
        if (limitBytes !== undefined) rememberStorageBeforePurchase(limitBytes);
        try {
            if (hasSubscription) {
                await updateSubscription(isDowngrade ? { ...payload, confirm_downgrade: confirmedDowngrade } : payload);
                rememberPlanChange(); onUpdated(); onClose();
            }
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
                    {/* Interval toggle - governs the whole cart (plan + add-ons) */}
                    <div className="flex items-center justify-center gap-1 rounded-lg bg-muted p-1 text-sm">
                        {(["month", "year"] as const).map((iv) => (
                            <button key={iv} type="button" onClick={() => setInterval(iv)}
                                className={`flex-1 rounded-md px-3 py-1.5 ${state.interval === iv ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}>
                                {iv === "month" ? "Monthly" : "Annual"}{iv === "year" && catalog.plans.some((p) => p.has_yearly) && <span className="ml-1 text-[10px] text-green-600">save ~17%</span>}
                            </button>
                        ))}
                    </div>

                    {mode === "plan" ? (
                        <div>
                            <p className="mb-1 text-xs font-medium text-muted-foreground">Your plan</p>
                            <PlanSelector plans={catalog.plans} interval={state.interval} selectedId={state.planId} onSelect={setPlan} />
                            <p className="mt-1 text-[11px] text-muted-foreground">
                                Picking a plan replaces your current one. To keep it and buy more space, use the add-ons below.
                            </p>
                        </div>
                    ) : (
                        <p className="text-sm font-medium">Add storage to your {currentPlan?.name ?? "current"} plan</p>
                    )}

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
                    {state.coupon && (
                        <p className="text-xs text-green-600">
                            Code {state.coupon.code} applied
                            {state.coupon.duration === "once" ? " - discounts your first payment only" : ""}
                            {state.coupon.duration === "repeating" && state.coupon.duration_in_months
                                ? ` - applies for ${state.coupon.duration_in_months} months` : ""}.
                        </p>
                    )}

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
                            {hasSubscription && previewCents != null && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Estimated next invoice (incl. proration): {formatCents(previewCents)}
                                </p>
                            )}
                        </div>
                    )}

                    {droppedAddons.length > 0 && (
                        <div className="flex items-start gap-1.5 text-xs text-amber-600">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                            {droppedAddons.map((a) => a.name).join(", ")} isn&apos;t sold on {state.interval === "year" ? "annual" : "monthly"} billing and won&apos;t be included.
                        </div>
                    )}

                    {isDowngrade && currentPlan && selectedPlan && (
                        <div className="rounded-lg border border-amber-500/40 bg-amber-50/70 p-3 dark:bg-amber-500/[0.07]">
                            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                                This replaces your {currentPlan.name} plan
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                {currentPlan.name} gives {formatBytes(currentPlan.storage_bytes)}; {selectedPlan.name} gives {formatBytes(selectedPlan.storage_bytes)}.
                                Add-ons and redeemed packages stay. Your files are never deleted.
                            </p>
                            <label htmlFor="confirm-downgrade" className="mt-2 flex items-center gap-2 text-xs font-medium">
                                <input
                                    id="confirm-downgrade"
                                    type="checkbox"
                                    checked={confirmedDowngrade}
                                    onChange={(e) => setConfirmedDowngrade(e.target.checked)}
                                />
                                Yes, move me to {selectedPlan.name}
                            </label>
                        </div>
                    )}

                    {downgradeWarning && (
                        <div className="flex items-start gap-1.5 text-xs text-amber-600">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                            This is below your current usage ({formatBytes(usedBytes)}). New uploads will be blocked until you empty the trash to free up space; nothing is deleted.
                        </div>
                    )}
                    {!planAvailableAtInterval && (
                        <div className="flex items-start gap-1.5 text-xs text-amber-600">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                            {selectedPlan?.name} isn&apos;t available on {state.interval === "year" ? "annual" : "monthly"} billing. Pick a different plan or switch the interval back.
                        </div>
                    )}
                    {error && <p className="text-xs text-red-600">{error}</p>}

                    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                        <p className="mr-auto text-xs text-muted-foreground">14-day money-back guarantee on every plan.</p>
                        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
                        <Button size="sm" onClick={submit} disabled={submitting || isPaid <= 0 || !planAvailableAtInterval || (isDowngrade && !confirmedDowngrade)}>
                            {hasSubscription ? "Update subscription" : "Continue to payment"}
                        </Button>
                    </div>
                </div>
            )}
        </Card>
    );
}
