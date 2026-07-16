import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle } from "lucide-react";
import {
    getCatalog, startCheckout, updateSubscription, validateCoupon,
    type Catalog, type CartPayload, type CouponInfo,
} from "@/api/billing";
import { apiErrorMessage } from "@/api/client";
import { computeCart, formatCents, formatBytes, type CartState } from "@/lib/billing/cart-math";
import { PlanSelector } from "./plan-selector";
import { AddonRow } from "./addon-row";

export function SubscriptionModal({ open, onOpenChange, hasSubscription, initial, usedBytes, onUpdated }: {
    open: boolean; onOpenChange: (v: boolean) => void; hasSubscription: boolean;
    initial: { interval: "month" | "year"; planId: string; addonQty: Record<string, number> };
    usedBytes: number; onUpdated: () => void;
}) {
    const [catalog, setCatalog] = useState<Catalog | null>(null);
    const [state, setState] = useState<CartState>({ ...initial, coupon: null });
    const [codeInput, setCodeInput] = useState("");
    const [couponError, setCouponError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        // Modal stays mounted across open/close (controlled purely by `open`, like ShareModal),
        // so reset all transient state on open — otherwise `submitting` stays true after a
        // successful update and the CTA is permanently disabled on reopen.
        setState({ ...initial, coupon: null });
        setSubmitting(false);
        setError(null);
        setCouponError(null);
        setCodeInput("");
        getCatalog().then(setCatalog).catch(() => setError("Failed to load plans"));
    }, [open]);

    if (!catalog) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-lg"><p className="py-10 text-center text-sm text-muted-foreground">Loading plans…</p></DialogContent>
            </Dialog>
        );
    }

    const selectedPlan = catalog.plans.find((p) => p.id === state.planId);
    const isPaid = selectedPlan?.price_monthly ?? 0;
    // Interval-change guard: the selected plan may not be sold on the newly-chosen
    // interval (e.g. a plan with has_yearly === false). Block submission rather than
    // silently sending an invalid cart.
    const planAvailableAtInterval = !selectedPlan || selectedPlan.price_monthly === 0
        || (state.interval === "year" ? selectedPlan.has_yearly : selectedPlan.has_monthly);
    const cart = computeCart(state, catalog);
    const downgradeWarning = cart.effectiveBytes < usedBytes;

    const setInterval = (interval: "month" | "year") => setState((s) => ({ ...s, interval }));
    const setPlan = (planId: string) => setState((s) => ({ ...s, planId }));
    const setQty = (id: string, qty: number) => setState((s) => ({ ...s, addonQty: { ...s.addonQty, [id]: qty } }));

    const applyCoupon = async () => {
        setCouponError(null);
        try { const info = await validateCoupon(codeInput.trim()); setState((s) => ({ ...s, coupon: info as CouponInfo })); }
        catch (e) { setState((s) => ({ ...s, coupon: null })); setCouponError(apiErrorMessage(e, "Invalid code")); }
    };

    const submit = async () => {
        setSubmitting(true); setError(null);
        const payload: CartPayload = {
            interval: state.interval, plan_id: state.planId,
            addons: Object.entries(state.addonQty)
                .filter(([id, q]) => q > 0 && catalog.addons.some((a) => a.id === id))
                .map(([id, qty]) => ({ id, qty })),
            promo_code: state.coupon?.code,
        };
        try {
            if (hasSubscription) { await updateSubscription(payload); onUpdated(); onOpenChange(false); }
            else { const { url } = await startCheckout(payload); window.location.href = url; }
        } catch (e) { setError(apiErrorMessage(e)); setSubmitting(false); }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader><DialogTitle>{hasSubscription ? "Manage subscription" : "Choose your plan"}</DialogTitle></DialogHeader>

                {/* Interval toggle */}
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

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={submit} disabled={submitting || isPaid <= 0 || !planAvailableAtInterval}>
                        {hasSubscription ? "Update subscription" : "Continue to payment"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
