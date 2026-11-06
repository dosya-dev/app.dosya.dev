import type { CatalogAddon, CatalogPlan, Currency } from "@/api/billing";
import { addonAvailableAt } from "@/lib/billing/cart-math";
import { INCLUDED_FACTS } from "@/lib/billing/included";
import { formatNumber } from "@/lib/format-locale";
import { useT } from "@/lib/i18n";
import { addonKind } from "@/lib/billing/addon-kind";
import { AddonBlock } from "./addon-row";
import { StorageComposition } from "./storage-composition";

/**
 * The chooser's add-ons, grouped by what they sell: storage (with the
 * composition bar), extra family places, and Smart Search room. A group
 * renders only when the catalog carries its kind; the Smart Search group
 * also needs a plan with limits, because units on a plan without Smart
 * Search buy nothing (the API refuses that cart too).
 */
export function AddonGroups({ addons, plan, interval, currency = "usd", qty, disabled, onChange, usedBytes, label }: {
    addons: CatalogAddon[];
    /** The selected plan, or null while none paid is picked. */
    plan: CatalogPlan | null;
    interval: "month" | "year";
    currency?: Currency;
    qty: Record<string, number>;
    /** No paid plan picked: every block is inert. */
    disabled: boolean;
    onChange: (id: string, qty: number) => void;
    /** Today's usage for a subscriber; omitted for a new customer. */
    usedBytes?: number;
    /** The storage group's heading row: the caption on the left, "per month, each" on the right. */
    label: { text: string; aside: string };
}) {
    const t = useT();
    const by = (kind: string) => addons.filter((a) => addonKind(a) === kind);
    const storage = by("storage");
    const family = by("family_places");
    const hasAi = !!plan && plan.ai_images_max != null && plan.ai_documents_max != null;
    const photos = hasAi ? by("ai_photos") : [];
    const documents = hasAi ? by("ai_documents") : [];
    const ai = [...photos, ...documents];
    const count = (list: CatalogAddon[]) => list.reduce((sum, a) => sum + (qty[a.id] ?? 0), 0);
    const units = (list: CatalogAddon[]) => list.reduce((sum, a) => sum + (qty[a.id] ?? 0) * (a.ai_units ?? 0), 0);
    const block = (a: CatalogAddon) => (
        <AddonBlock key={a.id} addon={a} interval={interval} currency={currency} qty={qty[a.id] ?? 0}
            disabled={disabled || !addonAvailableAt(a, interval)} onChange={(q) => onChange(a.id, q)} />
    );
    const included = INCLUDED_FACTS.familyPlaces;
    const extra = count(family);

    return (
        <div className="space-y-6">
            <section data-testid="addon-group-storage">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
                    <p>{label.text}</p>
                    <p>{label.aside}</p>
                </div>
                <div className="mt-2 grid gap-2.5 sm:grid-cols-3">{storage.map(block)}</div>
                {plan && !disabled && (
                    <StorageComposition
                        planBytes={plan.storage_bytes}
                        addons={storage.filter((a) => addonAvailableAt(a, interval)).map((a) => ({ id: a.id, bytes: a.storage_bytes, qty: qty[a.id] ?? 0 }))}
                        usedBytes={usedBytes}
                    />
                )}
            </section>

            {family.length > 0 && (
                <section data-testid="addon-group-family">
                    <p className="text-xs text-muted-foreground">{t("billing.label.groupFamily")}</p>
                    <div className="mt-2 grid gap-2.5 sm:grid-cols-3">{family.map(block)}</div>
                    <p className="mt-2 font-mono text-xs tabular-nums text-muted-foreground" data-testid="family-summary">
                        {extra > 0
                            ? t("billing.label.placesIncludedExtraTotal", { included, extra, total: included + extra })
                            : t("billing.label.placesIncluded", { included })}
                    </p>
                </section>
            )}

            {ai.length > 0 && hasAi && plan && (
                <section data-testid="addon-group-smart-search">
                    <p className="text-xs text-muted-foreground">{t("billing.label.groupSmartSearch")}</p>
                    <div className="mt-2 grid gap-2.5 sm:grid-cols-3">{ai.map(block)}</div>
                    <p className="mt-2 font-mono text-xs tabular-nums text-muted-foreground" data-testid="smart-search-summary">
                        {t("billing.label.smartSearchAfterThisChange", {
                            photos: formatNumber(plan.ai_images_max! + units(photos)),
                            documents: formatNumber(plan.ai_documents_max! + units(documents)),
                        })}
                    </p>
                </section>
            )}
        </div>
    );
}
