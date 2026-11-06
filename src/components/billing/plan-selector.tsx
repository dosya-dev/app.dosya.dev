import { Check } from "lucide-react";
import type { CatalogPlan, Currency } from "@/api/billing";
import { formatCents } from "@/lib/billing/cart-math";
import { approxPhotos, INCLUDED_FACTS, PLAN_FITS, TALK_TO_US_URL } from "@/lib/billing/included";
import { formatNumber } from "@/lib/format-locale";
import { richText } from "@/lib/rich-text";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

/**
 * The size rail: one strip, one cell per paid plan. A cell says what the size
 * is, what it costs on the chosen interval, who it fits and how much Smart
 * Search indexes there. Free is not a cell: it was never something to submit.
 */
export function PlanSelector({ plans, interval, currency = "usd", selectedId, currentPlanId, onSelect }: {
    plans: CatalogPlan[]; interval: "month" | "year"; currency?: Currency; selectedId: string; currentPlanId?: string; onSelect: (id: string) => void;
}) {
    const t = useT();
    const paid = plans.filter((p) => p.price_monthly > 0);
    const selected = paid.find((p) => p.id === selectedId);
    const per = t("billing.label.perMonthShort");

    return (
        <div>
            <p className="mb-2 text-xs text-muted-foreground">{t("billing.label.size")}</p>
            {/* gap-px over bg-border draws the dividers for any number of sizes;
                a lone last cell on the two-column phone grid spans the row. */}
            <div role="radiogroup" aria-label={t("billing.label.size")} className="grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border bg-border sm:grid-cols-3">
                {paid.map((p) => {
                    const sel = p.id === selectedId;
                    const available = interval === "year" ? p.has_yearly : p.has_monthly;
                    const yearly = p.price_yearly;
                    const perMonth = interval === "year" ? Math.round((yearly ?? 0) / 12) : p.price_monthly;
                    const billed = interval === "year"
                        ? t("billing.label.billedAmountAYear", { amount: formatCents(yearly ?? 0, currency) })
                        : yearly != null ? t("billing.label.amountAYearIfYearly", { amount: formatCents(yearly, currency) }) : null;
                    const fits = PLAN_FITS[p.id];
                    const hasAi = p.ai_images_max != null && p.ai_documents_max != null;
                    const quiet = sel ? "text-primary-foreground/70" : "text-muted-foreground";
                    return (
                        <button
                            key={p.id}
                            type="button"
                            role="radio"
                            aria-checked={sel}
                            aria-pressed={sel}
                            disabled={!available}
                            data-plan-id={p.id}
                            onClick={() => onSelect(p.id)}
                            className={cn(
                                "grid min-h-32 content-start gap-0.5 p-4 text-start transition-colors disabled:opacity-40",
                                "max-sm:[&:last-child:nth-child(odd)]:col-span-2",
                                sel ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
                            )}
                        >
                            <span className="mb-1 flex min-h-4 items-center justify-end gap-1.5">
                                {currentPlanId === p.id && (
                                    <span className="rounded-full border border-current px-1.5 text-[10px] font-bold uppercase leading-4 tracking-[0.05em] opacity-80">
                                        {t("billing.label.currentPlanTag")}
                                    </span>
                                )}
                                {sel && <Check className="size-4" aria-hidden="true" />}
                            </span>
                            <span className="text-xl font-bold leading-tight tracking-[-0.02em]">{p.storage_label}</span>
                            {/* Sizes above Business are named by their size alone. */}
                            {p.name !== p.storage_label && <span className={cn("text-xs", quiet)}>{p.name}</span>}
                            <span className="mt-2.5 font-mono text-[15px] font-bold tabular-nums">
                                {formatCents(perMonth, currency)}
                                <span className={cn("font-sans text-[11px] font-medium", quiet)}>{per}</span>
                            </span>
                            {billed && <span className={cn("text-[11px] leading-snug", quiet)}>{billed}</span>}
                            {fits && <span className={cn("mt-2 text-xs leading-snug", quiet)}>{t(fits)}</span>}
                            {hasAi && (
                                <span className={cn("mt-2 border-t border-dashed pt-2 text-[11px] leading-snug", sel ? "border-primary-foreground/30" : "border-border", quiet)}>
                                    {t("billing.label.smartSearchPhotosPhotosDocumentsDocuments", { photos: formatNumber(p.ai_images_max!), documents: formatNumber(p.ai_documents_max!) })}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
            {selected && (
                <p className="mt-2 text-xs text-muted-foreground">
                    {approxPhotos(selected.storage_bytes) > 0 && (
                        <>
                            {richText(
                                t("billing.description.plannameHoldsAboutPhotosPhonePhotos", { planName: "{planName}", photos: formatNumber(approxPhotos(selected.storage_bytes)) }),
                                { planName: <b className="font-semibold text-foreground">{selected.name}</b> },
                            )}{" "}
                        </>
                    )}
                    {richText(
                        t("billing.description.needMoreThanTbTalktous", { tb: INCLUDED_FACTS.selfServeMaxTb, talkToUs: "{talkToUs}" }),
                        { talkToUs: <a href={TALK_TO_US_URL} target="_blank" rel="noreferrer" className="font-medium underline-offset-2 hover:underline" style={{ color: "var(--brand-text)" }}>{t("billing.action.talkToUs")}</a> },
                    )}
                </p>
            )}
        </div>
    );
}
