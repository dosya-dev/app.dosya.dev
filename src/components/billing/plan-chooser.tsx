import { formatDateWith } from '@/lib/format-locale';
import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { AlertTriangle, X } from "lucide-react";
import {
    getCatalog, startCheckout, updateSubscription, previewSubscription, validateCoupon,
    type Catalog, type CartPayload, type CouponInfo, type Currency,
} from "@/api/billing";
import { apiErrorBody, apiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { richText } from "@/lib/rich-text";
import {
    computeCart, formatBytes, addonAvailableAt, yearlySavingPct, storedCurrency, rememberCurrency, type CartState,
} from "@/lib/billing/cart-math";
import { rememberPlanChange, rememberStorageBeforePurchase } from "@/lib/checkout-return";
import { PlanSelector } from "./plan-selector";
import { AddonGroups } from "./addon-groups";
import { IncludedFeatures } from "./included-features";
import { CartReceipt } from "./cart-receipt";
import { useT, currentLocale } from "@/lib/i18n";
import { tidyText } from "@/lib/billing/catalog-select";
import { cn } from "@/lib/utils";

/** The interval adjective of the removed-code message: the lower-cased Monthly / Yearly label. */
function intervalWord(interval: "month" | "year", t: ReturnType<typeof useT>): string {
    return (interval === "year" ? t("common.label.yearly") : t("common.label.monthly")).toLocaleLowerCase(currentLocale());
}

/**
 * Inline (in-page) plan/add-on chooser - the same cart flow the SubscriptionModal
 * used, but rendered as a Card directly on the billing page instead of a dialog.
 * Mounted only while open, so it initializes fresh from `initial` each time.
 */
export function PlanChooser({ hasSubscription, trialEligible = false, initial, usedBytes, limitBytes, currentPlanId, mode = "plan", onUpdated, onClose, onEditReservations }: {
    hasSubscription: boolean;
    /** The account has never had a subscription: the first one starts with a 7-day free trial. */
    trialEligible?: boolean;
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
    /** The plan is too small for the family's storage reservations: take the payer to the Family card. */
    onEditReservations?: () => void;
}) {
    const t = useT();
    const [catalog, setCatalog] = useState<Catalog | null>(null);
    const [state, setState] = useState<CartState>({ ...initial, currency: "usd", coupon: null });
    const [codeInput, setCodeInput] = useState("");
    const [couponError, setCouponError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmedDowngrade, setConfirmedDowngrade] = useState(false);
    // The API refused a plan smaller than the family's reservations (409 family_reservations_exceed_plan).
    // The figures stay after closing so the dialog does not go blank while it animates out.
    const [reservationConflict, setReservationConflict] = useState<{ reservedBytes: number; newBytes: number; planName: string } | null>(null);
    const [conflictOpen, setConflictOpen] = useState(false);

    // The catalog decides the currency: a subscriber gets the one the account is
    // billed in, anyone else the remembered pick when the server still offers it.
    const catalogSeq = useRef(0);
    const loadCatalog = (currency?: Currency) => {
        const seq = ++catalogSeq.current;
        return getCatalog(currency).then((c) => {
            if (catalogSeq.current !== seq) return null;
            setCatalog(c);
            setState((s) => ({ ...s, currency: c.currency ?? "usd" }));
            return c;
        });
    };
    useEffect(() => {
        loadCatalog(hasSubscription ? undefined : storedCurrency()).catch(() => setError(t("billing.error.failedToLoadPlans")));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const selectedPlan = catalog?.plans.find((p) => p.id === state.planId);
    const yearlyPct = catalog ? yearlySavingPct(catalog.plans, state.planId) : null;
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

    const offersTrial = trialEligible && !hasSubscription;
    const trialEndsOn = formatDateWith(new Date(Date.now() + 7 * 86400 * 1000), { month: "long", day: "numeric", year: "numeric" }, 'en-US');

    // A fresh pick has to be confirmed again.
    useEffect(() => { setConfirmedDowngrade(false); }, [state.planId]);

    // Switching the billing period drops a code that is limited to the other
    // one, and says so, instead of letting checkout refuse it later.
    const setInterval = (interval: "month" | "year") => {
        const c = state.coupon;
        if (c?.intervals && !c.intervals.includes(interval)) {
            setCouponError(t("billing.error.codeCcodeRemovedItIsForIntervalBillingOnly", { cCode: c.code, intervalsCount: c.intervals.length, cInterval: intervalWord(c.intervals[0], t) }));
            setState((s) => ({ ...s, interval, coupon: null }));
            return;
        }
        setState((s) => ({ ...s, interval }));
    };
    // Switching the currency reprices the cart from that currency's catalog. An
    // amount code in the other currency can't discount it, so it goes, with the
    // reason, the same way the interval switch drops a code.
    const setCurrency = (currency: Currency) => {
        if (currency === state.currency) return;
        rememberCurrency(currency);
        const c = state.coupon;
        loadCatalog(currency).then((cat) => {
            if (!cat) return;
            const next = cat.currency ?? "usd";
            const drop = c?.type === "amount" && (c.currency ?? "usd").toLowerCase() !== next;
            if (drop) setCouponError(t((c.currency ?? "usd").toLowerCase() === "eur" ? "billing.error.thatCodeIsInEurosSoItWasRemoved" : "billing.error.thatCodeIsInUsDollarsSoItWasRemoved"));
            setState((s) => ({
                ...s,
                coupon: drop ? null : s.coupon,
                planId: cat.plans.some((p) => p.id === s.planId) ? s.planId : (cat.plans.find((p) => p.price_monthly > 0)?.id ?? s.planId),
            }));
        }).catch(() => setError(t("billing.error.failedToLoadPlans")));
    };
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
        currency: state.currency,
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
        const timer = setTimeout(() => {
            previewSubscription(buildPayload(catalog))
                .then((r) => { if (previewSeq.current === seq) setPreviewCents(r.amount_due); })
                .catch(() => { if (previewSeq.current === seq) setPreviewCents(null); });
        }, 400);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasSubscription, catalog, state.planId, state.interval, state.addonQty]);

    const applyCoupon = async () => {
        setCouponError(null);
        try {
            const info = await validateCoupon(codeInput.trim(), state.interval, state.currency);
            // An amount code with no option in the cart's currency: checkout would refuse it.
            if (info.type === "amount" && (info.currency ?? "usd").toLowerCase() !== state.currency) {
                setState((s) => ({ ...s, coupon: null }));
                setCouponError(t(state.currency === "eur" ? "billing.error.thisCodeCanTBeUsedWithEuroPrices" : "billing.error.thisCodeCanTBeUsedWithUsDollarPrices"));
                return;
            }
            setState((s) => ({ ...s, coupon: info as CouponInfo }));
        }
        catch (e) { setState((s) => ({ ...s, coupon: null })); setCouponError(apiErrorMessage(e, t("common.error.invalidCode"))); }
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
        } catch (e) {
            const body = apiErrorBody(e);
            if (body?.code === "family_reservations_exceed_plan" && typeof body.reserved_bytes === "number" && typeof body.new_storage_bytes === "number") {
                setReservationConflict({ reservedBytes: body.reserved_bytes, newBytes: body.new_storage_bytes, planName: selectedPlan?.name ?? "" });
                setConflictOpen(true);
            } else {
                setError(apiErrorMessage(e));
            }
            setSubmitting(false);
        }
    };

    const familyPlaceMonthly = catalog?.addons.find((a) => a.kind === "family_places")?.price_monthly ?? null;
    const subtitle = mode === "addons"
        ? t("billing.description.stacksOnTopOfYourPlannamePlanYourPlanDoesNotChange", { planName: currentPlan?.name ?? t("billing.label.current") })
        : hasSubscription ? t("billing.description.pickASizeThenHowToPayAddOnsStackOnTop")
            : offersTrial ? t("billing.description.pickASizeThenHowToPayYourFirstPaidPlanStarts")
                : t("billing.description.pickASizeThenHowToPay");
    const warnings: ReactNode = (
        <>
            {droppedAddons.length > 0 && (
                <div className="mt-3 flex items-start gap-1.5 text-xs text-amber-600">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    {/* The sentence is the catalog's three fragments: names, "isn't sold on", the interval word, "billing and won't be included." */}
                    {/* TODO(catalog): four fragments joined by code; tidyText closes the space some languages leave before ; or , and the interval word is the lower-cased label. */}
                    {tidyText([droppedAddons.map((a) => a.name).join(", "), t("billing.label.isnTSoldOn"), (state.interval === "year" ? t("billing.action.annual") : t("billing.action.monthly")).toLocaleLowerCase(currentLocale()), t("billing.description.billingAndWonTBeIncluded")].join(" "))}
                </div>
            )}
            {!planAvailableAtInterval && (
                <div className="mt-3 flex items-start gap-1.5 text-xs text-amber-600">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    {t("billing.description.selectedplannameIsnTAvailableOnStateintervalyearSelectTrueAnnualOtherMonthlyBilling", { selectedPlanName: selectedPlan?.name ?? "", stateIntervalYear: String(state.interval === "year") })}
                </div>
            )}
            {error && <p dir="auto" className="mt-3 text-xs text-red-600">{error}</p>}
        </>
    );

    return (
        <Card className="mb-5 gap-0 overflow-hidden py-0">
            <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
                <div className="min-w-0">
                    <h2 className="text-sm font-semibold">{mode === "addons" ? t("billing.heading.addStorage") : hasSubscription ? t("billing.heading.changeYourPlan") : t("billing.heading.chooseYourPlan")}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
                </div>
                <button type="button" onClick={onClose} className="flex size-7 shrink-0 items-center justify-center rounded hover:bg-muted" aria-label={t("common.close")}>
                    <X className="size-4 text-muted-foreground" />
                </button>
            </div>

            {!catalog ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("billing.label.loadingPlans")}</p>
            ) : (
                <div className="grid md:grid-cols-[minmax(0,1fr)_300px]">
                    <div className="min-w-0 space-y-6 p-5">
                        {/* Interval and currency, side by side. Both govern the whole cart (plan + add-ons). */}
                        <div className="flex flex-wrap items-center justify-between gap-2.5">
                            <Segmented
                                label={t("billing.label.yourPlan")}
                                value={state.interval}
                                onChange={setInterval}
                                options={[
                                    { value: "month", label: t("billing.action.monthly") },
                                    { value: "year", label: <>{t("billing.action.yearly")}{yearlyPct != null && yearlyPct > 0 && <span className="text-[10px] font-bold uppercase tracking-[0.04em]" style={{ color: "var(--brand-text)" }}>{t("billing.label.percentOff", { percent: yearlyPct })}</span>}</> },
                                ]}
                            />
                            {/* Currency: only before the first subscription; after that the account is billed in one */}
                            {!hasSubscription && (catalog.currencies?.length ?? 0) > 1 && (
                                <Segmented
                                    label={t("billing.label.currency")}
                                    value={state.currency}
                                    onChange={setCurrency}
                                    options={(["usd", "eur"] as const).filter((c) => catalog.currencies.includes(c)).map((c) => ({ value: c, label: c === "usd" ? "USD $" : "EUR €" }))}
                                />
                            )}
                        </div>

                        {mode === "plan" && (
                            <div>
                                <PlanSelector plans={catalog.plans} interval={state.interval} currency={state.currency} selectedId={state.planId} currentPlanId={currentPlanId} onSelect={setPlan} />
                                {selectedPlan && isPaid > 0 && <IncludedFeatures plan={selectedPlan} familyPlaceMonthly={familyPlaceMonthly} currency={state.currency} />}
                            </div>
                        )}

                        <AddonGroups
                            addons={catalog.addons}
                            plan={selectedPlan && isPaid > 0 ? selectedPlan : null}
                            interval={state.interval}
                            currency={state.currency}
                            qty={state.addonQty}
                            disabled={isPaid <= 0}
                            onChange={setQty}
                            usedBytes={hasSubscription ? usedBytes : undefined}
                            label={{
                                text: (mode === "addons" && currentPlan
                                    ? t("billing.label.storageOnTopOfPlannameSize", { planName: currentPlan.name, size: currentPlan.storage_label })
                                    : t("billing.label.addStorageOnTop")) + (isPaid <= 0 ? ` ${t("billing.label.selectAPaidPlanFirst")}` : ""),
                                aside: t(state.interval === "year" ? "billing.label.perYearEach" : "billing.label.perMonthEach"),
                            }}
                        />

                        {isDowngrade && currentPlan && selectedPlan && (
                            <div className="rounded-xl border border-amber-500/40 bg-amber-50/70 p-3 dark:bg-amber-500/[0.07]">
                                <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                                    {t("billing.label.thisReplacesYourCurrentplannamePlan", { currentPlanName: currentPlan.name })}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {t("billing.description.currentplannameGivesCurrentplanstorageBytesSelectedplannameGivesSelectedplanstorageBytesAddOnsAndRedeemedPackagesStay", { currentPlanName: currentPlan.name, currentPlanStorage_bytes: formatBytes(currentPlan.storage_bytes), selectedPlanName: selectedPlan.name, selectedPlanStorage_bytes: formatBytes(selectedPlan.storage_bytes) })}
                                </p>
                                <label htmlFor="confirm-downgrade" className="mt-2 flex items-center gap-2 text-xs font-medium">
                                    <input
                                        id="confirm-downgrade"
                                        type="checkbox"
                                        checked={confirmedDowngrade}
                                        onChange={(e) => setConfirmedDowngrade(e.target.checked)}
                                    />
                                    {t("billing.label.yesMoveMeTo")} {selectedPlan.name}
                                </label>
                            </div>
                        )}

                        {downgradeWarning && (
                            <div className="flex items-start gap-1.5 text-xs text-amber-600">
                                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                {t("billing.description.thisIsBelowYourCurrentUsageUsedbytesNewUploadsWillBe", { usedBytes: formatBytes(usedBytes) })}
                            </div>
                        )}
                    </div>

                    {cart && (
                        <CartReceipt
                            cart={cart}
                            currency={state.currency}
                            interval={state.interval}
                            hasSubscription={hasSubscription}
                            previewCents={previewCents}
                            offersTrial={!!(offersTrial && cart)}
                            trialEndsOn={trialEndsOn}
                            coupon={state.coupon}
                            couponError={couponError}
                            codeInput={codeInput}
                            onCodeInput={setCodeInput}
                            onApplyCoupon={applyCoupon}
                            submitting={submitting}
                            submitDisabled={isPaid <= 0 || !planAvailableAtInterval || (isDowngrade && !confirmedDowngrade)}
                            ctaLabel={hasSubscription ? t("billing.action.updateSubscription") : offersTrial ? t("billing.action.start7DayFreeTrial") : t("billing.action.continueToPayment")}
                            onSubmit={submit}
                        >
                            {warnings}
                        </CartReceipt>
                    )}
                </div>
            )}
            <ReservationsDontFitDialog
                open={conflictOpen}
                conflict={reservationConflict}
                keepPlanName={currentPlan?.name ?? ""}
                onKeep={() => { setConflictOpen(false); onClose(); }}
                onEdit={() => { setConflictOpen(false); onEditReservations?.(); }}
                onDismiss={() => setConflictOpen(false)}
            />
        </Card>
    );
}

/**
 * The plan change would leave less storage than the family has reserved, and
 * the API refused it. Nothing changed. The payer either lowers the
 * reservations first (Edit reservations takes them to the Family card) or
 * keeps the plan they have.
 */
function ReservationsDontFitDialog({ open, conflict: c, keepPlanName, onKeep, onEdit, onDismiss }: {
    open: boolean;
    conflict: { reservedBytes: number; newBytes: number; planName: string } | null;
    keepPlanName: string;
    onKeep: () => void;
    onEdit: () => void;
    onDismiss: () => void;
}) {
    const t = useT();
    const fits = c ? Math.min(100, (c.newBytes / Math.max(c.reservedBytes, 1)) * 100) : 0;
    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onDismiss(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-lg font-semibold leading-tight">{t("billing.heading.reservationsDonTFit")}</DialogTitle>
                    <DialogDescription>
                        {c && richText(t("billing.description.yourFamilyHasReservedReservedWhichIsMoreThanTheSize", { reserved: "{reserved}", size: "{size}", planName: c.planName }), {
                            reserved: <strong className="text-foreground">{formatBytes(c.reservedBytes)}</strong>,
                            size: <strong className="text-foreground">{formatBytes(c.newBytes)}</strong>,
                        })}
                    </DialogDescription>
                </DialogHeader>
                {c && (
                    <div>
                        <div aria-hidden="true" className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted">
                            <span className="h-full bg-foreground/70" style={{ width: `${fits}%` }} />
                            <span className="h-full flex-1 bg-destructive/30" />
                        </div>
                        <div className="mt-2 flex justify-between gap-3 text-xs text-muted-foreground">
                            <span>{t("billing.label.planNameSize", { planName: c.planName, size: formatBytes(c.newBytes) })}</span>
                            <span>{t("billing.label.reservedSize", { size: formatBytes(c.reservedBytes) })}</span>
                        </div>
                    </div>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={onKeep}>{t("billing.action.keepPlanName", { planName: keepPlanName })}</Button>
                    <Button onClick={onEdit}>{t("billing.action.editReservations")}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/** Two or three options in one bordered strip; the chosen one lifts onto the card surface. */
function Segmented<T extends string>({ label, value, options, onChange }: {
    label: string; value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void;
}) {
    return (
        <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-[10px] border bg-muted p-[3px]">
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    aria-pressed={o.value === value}
                    onClick={() => onChange(o.value)}
                    className={cn(
                        "inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors",
                        o.value === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}
