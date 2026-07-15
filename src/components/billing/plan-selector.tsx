import { Check } from "lucide-react";
import type { CatalogPlan } from "@/api/billing";
import { formatCents } from "@/lib/billing/cart-math";
import { cn } from "@/lib/utils";

export function PlanSelector({ plans, interval, selectedId, onSelect }: {
    plans: CatalogPlan[]; interval: "month" | "year"; selectedId: string; onSelect: (id: string) => void;
}) {
    return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {plans.map((p) => {
                const price = interval === "year" ? (p.price_yearly ?? 0) : p.price_monthly;
                const selected = p.id === selectedId;
                const available = p.price_monthly === 0 || (interval === "year" ? p.has_yearly : p.has_monthly);
                return (
                    <button
                        key={p.id}
                        type="button"
                        disabled={!available}
                        onClick={() => onSelect(p.id)}
                        className={cn(
                            "relative rounded-lg border p-3 text-left transition-colors disabled:opacity-40",
                            selected ? "border-primary ring-1 ring-primary" : "hover:border-muted-foreground/30",
                        )}
                    >
                        {selected && <Check className="absolute right-2 top-2 size-4 text-primary" />}
                        <p className="text-sm font-semibold">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.storage_label}</p>
                        <p className="mt-1 text-sm font-bold">
                            {p.price_monthly === 0 ? "Free" : `${formatCents(price)}`}
                            {p.price_monthly !== 0 && <span className="text-xs font-normal text-muted-foreground">/{interval === "year" ? "yr" : "mo"}</span>}
                        </p>
                    </button>
                );
            })}
        </div>
    );
}
