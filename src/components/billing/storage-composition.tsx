import { formatBytes } from "@/lib/billing/cart-math";
import { richText } from "@/lib/rich-text";
import { useT } from "@/lib/i18n";

export type CompositionAddon = { id: string; bytes: number; qty: number };

/**
 * The storage the account ends up with: the plan in ink, one blue segment per
 * add-on, and for a subscriber a red marker at today's usage. The bar is
 * scaled to the larger of the new total and the usage, so a downgrade below
 * what is stored shows the marker past the end of what is bought.
 */
export function StorageComposition({ planBytes, addons, usedBytes }: {
    planBytes: number;
    addons: CompositionAddon[];
    /** Today's usage; omitted for an account with nothing to compare against. */
    usedBytes?: number;
}) {
    const t = useT();
    const chosen = addons.filter((a) => a.qty > 0);
    const total = planBytes + chosen.reduce((sum, a) => sum + a.bytes * a.qty, 0);
    const scale = Math.max(total, usedBytes ?? 0, 1);
    const pct = (bytes: number) => `${(bytes / scale) * 100}%`;
    const bold = (v: string) => <b className="font-semibold text-foreground">{v}</b>;
    const caption = usedBytes != null
        ? richText(t("billing.label.totalTotalUsedUsedToday", { total: "{total}", used: formatBytes(usedBytes) }), { total: bold(formatBytes(total)) })
        : richText(t("billing.label.totalTotal", { total: "{total}" }), { total: bold(formatBytes(total)) });
    const label = usedBytes != null
        ? t("billing.accessibility.totalInTotalUsedUsedToday", { total: formatBytes(total), used: formatBytes(usedBytes) })
        : t("billing.accessibility.totalInTotal", { total: formatBytes(total) });

    return (
        <div className="mt-3.5" data-testid="storage-composition">
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{t("billing.label.storageAfterThisChange")}</span>
                <span className="font-mono tabular-nums">{caption}</span>
            </div>
            <div className="relative mt-1.5" role="img" aria-label={label}>
                <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                    <span data-kind="plan" className="h-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: pct(planBytes) }} />
                    {chosen.map((a) => (
                        <span key={a.id} data-kind="addon" className="h-full bg-blue-500 shadow-[inset_1px_0_0_var(--card)] transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: pct(a.bytes * a.qty) }} />
                    ))}
                </div>
                {usedBytes != null && (
                    <i data-kind="used" className="absolute -bottom-1 -top-1 w-0.5 bg-destructive transition-[inset-inline-start] duration-300 ease-out motion-reduce:transition-none" style={{ insetInlineStart: pct(usedBytes) }} aria-hidden="true" />
                )}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-3.5 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-primary" aria-hidden="true" />{t("billing.label.legendPlan")}</span>
                <span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-blue-500" aria-hidden="true" />{t("billing.label.legendAddOns")}</span>
                {usedBytes != null && <span className="flex items-center gap-1.5"><i className="h-2 w-0.5 bg-destructive" aria-hidden="true" />{t("billing.label.legendUsedToday")}</span>}
            </div>
        </div>
    );
}
