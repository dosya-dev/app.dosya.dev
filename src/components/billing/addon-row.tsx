import { Button } from "@/components/ui/button";
import { Minus, Plus } from "lucide-react";
import type { CatalogAddon } from "@/api/billing";
import { formatCents } from "@/lib/billing/cart-math";

export function AddonRow({ addon, interval, qty, disabled, onChange }: {
    addon: CatalogAddon; interval: "month" | "year"; qty: number; disabled: boolean; onChange: (qty: number) => void;
}) {
    const unit = interval === "year" ? (addon.price_yearly ?? 0) : addon.price_monthly;
    const dec = () => onChange(Math.max(0, qty - 1));
    const inc = () => onChange(Math.min(addon.max_quantity, qty + 1));

    return (
        <div className="flex items-center justify-between py-2.5 border-b last:border-b-0">
            <div className="min-w-0">
                <p className="text-sm font-medium">{addon.name}</p>
                <p className="text-xs text-muted-foreground">{formatCents(unit)}/{interval === "year" ? "yr" : "mo"} each · {addon.storage_label}</p>
            </div>
            <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="icon" className="size-7" disabled={disabled || qty <= 0} onClick={dec} aria-label={`Remove ${addon.name}`}>
                    <Minus className="size-3.5" />
                </Button>
                <span className="w-6 text-center text-sm tabular-nums" aria-live="polite">{qty}</span>
                <Button type="button" variant="outline" size="icon" className="size-7" disabled={disabled || qty >= addon.max_quantity} onClick={inc} aria-label={`Add ${addon.name}`}>
                    <Plus className="size-3.5" />
                </Button>
            </div>
        </div>
    );
}
