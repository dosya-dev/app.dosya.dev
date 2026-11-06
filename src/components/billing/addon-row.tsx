import { Minus, Plus } from "lucide-react";
import type { CatalogAddon, Currency } from "@/api/billing";
import { formatBytes, formatCents } from "@/lib/billing/cart-math";
import { formatNumber } from "@/lib/format-locale";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import type { T } from "@/i18n/translator";
import { addonDisplayName, addonKind } from "@/lib/billing/addon-kind";

/** The bottom line: a limit at zero, a sum above zero. */
function addonLine(addon: CatalogAddon, qty: number, t: T): string {
    const units = (addon.ai_units ?? 0) * qty;
    switch (addonKind(addon)) {
        case "family_places":
            return qty > 0 ? t("billing.label.nExtraPlaces", { n: qty }) : t("billing.label.upToMaxMore", { max: addon.max_quantity });
        case "ai_photos":
            return qty > 0 ? t("billing.label.nPhotosAdded", { n: formatNumber(units) }) : t("billing.label.nPhotosEach", { n: formatNumber(addon.ai_units ?? 0) });
        case "ai_documents":
            return qty > 0 ? t("billing.label.nDocumentsAdded", { n: formatNumber(units) }) : t("billing.label.nDocumentsEach", { n: formatNumber(addon.ai_units ?? 0) });
        default:
            return qty > 0 ? t("billing.label.sizeAdded", { size: formatBytes(addon.storage_bytes * qty) }) : t("billing.label.upToMaxTimesSize", { max: addon.max_quantity, size: addon.storage_label });
    }
}

/**
 * One add-on as a block: its name, the unit price on the chosen interval, a
 * stepper, and a line that reads as a limit at zero ("up to 50 × 100 GB")
 * and as a sum once some are chosen ("200 GB added · $4/mo"). A block with
 * a count is tinted in the ledger's add-on blue.
 */
export function AddonBlock({ addon, interval, currency = "usd", qty, disabled, onChange }: {
    addon: CatalogAddon; interval: "month" | "year"; currency?: Currency; qty: number; disabled: boolean; onChange: (qty: number) => void;
}) {
    const t = useT();
    const unit = interval === "year" ? (addon.price_yearly ?? 0) : addon.price_monthly;
    const per = t(interval === "year" ? "billing.label.perYearShort" : "billing.label.perMonthShort");
    const on = qty > 0;
    const name = addonDisplayName(addon, t);
    const dec = () => onChange(Math.max(0, qty - 1));
    const inc = () => onChange(Math.min(addon.max_quantity, qty + 1));

    return (
        <div
            data-addon-id={addon.id}
            data-addon-kind={addonKind(addon)}
            data-active={on || undefined}
            aria-disabled={disabled || undefined}
            className={cn("grid gap-2 rounded-xl border p-3.5 transition-colors", on ? "border-blue-500 bg-blue-500/10" : "bg-card", disabled && "opacity-50")}
        >
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-[15px] font-bold tracking-[-0.01em]">{name}</span>
                <span className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
                    <b className="font-bold text-foreground">{formatCents(unit, currency)}</b>{per}
                </span>
            </div>
            <div className="inline-flex w-max items-center overflow-hidden rounded-lg border bg-card" role="group" aria-label={name}>
                <button
                    type="button"
                    className="grid size-7 place-items-center hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={disabled || qty <= 0}
                    onClick={dec}
                    aria-label={t("billing.action.removeAddonname", { addonName: name })}
                >
                    <Minus className="size-3.5" aria-hidden="true" />
                </button>
                <output className="min-w-7 border-x text-center font-mono text-sm leading-7 tabular-nums" aria-live="polite">{qty}</output>
                <button
                    type="button"
                    className="grid size-7 place-items-center hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={disabled || qty >= addon.max_quantity}
                    onClick={inc}
                    aria-label={t("billing.action.addAddonname", { addonName: name })}
                >
                    <Plus className="size-3.5" aria-hidden="true" />
                </button>
            </div>
            <div className={cn("flex justify-between gap-2 font-mono text-[11px] tabular-nums", on ? "text-foreground" : "text-muted-foreground")}>
                <span>{addonLine(addon, qty, t)}</span>
                {on && <span>{formatCents(unit * qty, currency)}{per}</span>}
            </div>
        </div>
    );
}

/** The block's old name, kept for one release so nothing outside billing breaks. */
export const AddonRow = AddonBlock;
