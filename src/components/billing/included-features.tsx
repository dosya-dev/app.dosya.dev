import type { ReactNode } from "react";
import { Download, History, LayoutGrid, Link2, Lock, MessageCircle, MonitorSmartphone, Plug, Search, Users, type LucideIcon } from "lucide-react";
import type { CatalogPlan, Currency } from "@/api/billing";
import type { MessageKey } from "@/i18n/keys";
import { formatCents } from "@/lib/billing/cart-math";
import { INCLUDED_FACTS, PRICING_COMPARE_URL } from "@/lib/billing/included";
import { formatNumber } from "@/lib/format-locale";
import { richText } from "@/lib/rich-text";
import { useT } from "@/lib/i18n";

type Entry = { icon: LucideIcon; name: string; desc: ReactNode; free?: ReactNode };

/**
 * What every paid size includes, listed once under the rail because the list
 * is the same at every size. Only the Smart Search numbers follow the plan.
 * Each figure is a shipped fact (see lib/billing/included.ts); the numbers
 * are set in bold through richText so each language keeps its word order.
 */
export function IncludedFeatures({ plan, familyPlaceMonthly, currency = "usd" }: {
    plan: CatalogPlan;
    /** Monthly price of one extra family place in `currency`, or null when not sold. */
    familyPlaceMonthly: number | null;
    currency?: Currency;
}) {
    const t = useT();
    const f = INCLUDED_FACTS;
    const bold = (v: string | number) => <b className="font-semibold text-foreground tabular-nums">{v}</b>;
    const rich = (key: MessageKey, vars: Record<string, string | number>) => richText(
        t(key, Object.fromEntries(Object.keys(vars).map((k) => [k, `{${k}}`]))),
        Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, bold(v)])),
    );

    const hasAi = plan.ai_images_max != null && plan.ai_documents_max != null;
    const entries: Entry[] = [
        ...(hasAi ? [{
            icon: Search,
            name: t("billing.included.smartSearch.name"),
            desc: rich("billing.included.smartSearch.desc", { photos: formatNumber(plan.ai_images_max!), documents: formatNumber(plan.ai_documents_max!) }),
            free: t("billing.included.smartSearch.free"),
        }] : []),
        { icon: MonitorSmartphone, name: t("billing.included.devices.name"), desc: t("billing.included.devices.desc") },
        { icon: Link2, name: t("billing.included.brandedLinks.name"), desc: t("billing.included.brandedLinks.desc"), free: rich("billing.included.brandedLinks.free", { count: f.freeShareLinks }) },
        { icon: Download, name: t("billing.included.downloads.name"), desc: t("billing.included.downloads.desc"), free: rich("billing.included.downloads.free", { gb: f.freeEgressGbPerDay }) },
        {
            icon: Users,
            name: t("billing.included.family.name"),
            desc: familyPlaceMonthly != null
                ? rich("billing.included.family.desc", { places: f.familyPlaces, price: formatCents(familyPlaceMonthly, currency) })
                : rich("billing.included.family.descNoPrice", { places: f.familyPlaces }),
        },
        { icon: History, name: t("billing.included.history.name"), desc: rich("billing.included.history.desc", { trashDays: f.trashDays, activityDays: f.activityDays }), free: rich("billing.included.history.free", { days: f.freeHistoryDays }) },
        { icon: LayoutGrid, name: t("billing.included.workspaces.name"), desc: t("billing.included.workspaces.desc"), free: rich("billing.included.workspaces.free", { workspaces: f.freeWorkspaces, members: f.freeMembersPerWorkspace }) },
        { icon: Plug, name: t("billing.included.connect.name"), desc: rich("billing.included.connect.desc", { apiKeys: f.apiKeys, webhooks: f.webhooksPerWorkspace }) },
        { icon: Lock, name: t("billing.included.private.name"), desc: rich("billing.included.private.desc", { regions: f.regions }) },
        { icon: MessageCircle, name: t("billing.included.support.name"), desc: rich("billing.included.support.desc", { days: f.ticketResponseBusinessDays }), free: t("billing.included.support.free") },
    ];

    return (
        <section className="mt-3.5 overflow-hidden rounded-[14px] border" data-testid="included-features" aria-labelledby="included-features-title">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-muted px-4 py-3">
                <h3 id="included-features-title" className="text-[13px] font-semibold">{t("billing.heading.everythingInPlanname", { planName: plan.name })}</h3>
                <a href={PRICING_COMPARE_URL} target="_blank" rel="noreferrer" className="text-xs font-medium underline-offset-2 hover:underline" style={{ color: "var(--brand-text)" }}>
                    {t("billing.action.fullComparisonWithFree")}
                </a>
            </div>
            <ul className="grid sm:grid-cols-2">
                {entries.map((e) => (
                    <li
                        key={e.name}
                        className="grid min-w-0 grid-cols-[18px_minmax(0,1fr)] gap-x-2.5 border-b px-4 py-2.5 last:border-b-0 sm:odd:border-e sm:[&:nth-last-child(-n+2)]:border-b-0"
                    >
                        <e.icon className="mt-0.5 size-4" style={{ color: "var(--brand-text)" }} aria-hidden="true" />
                        <div className="min-w-0">
                            <p className="text-[13px] font-semibold">{e.name}</p>
                            <p className="text-xs leading-[1.45] text-muted-foreground">{e.desc}</p>
                            {e.free && <p className="mt-0.5 text-[11px] leading-[1.4] text-muted-foreground/85">{e.free}</p>}
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );
}
