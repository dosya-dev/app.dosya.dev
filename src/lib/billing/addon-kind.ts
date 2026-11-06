import type { CatalogAddon } from "@/api/billing";
import { formatNumber } from "@/lib/format-locale";
import type { T } from "@/i18n/translator";

/** What the catalog says this add-on sells; older API builds omit `kind`. */
export const addonKind = (addon: CatalogAddon) => addon.kind ?? "storage";

/**
 * The block's name, rendered from the kind rather than the catalog string so
 * it translates: "+100 GB" is language-neutral and stays as the catalog says;
 * places and Smart Search units are worded per language.
 */
export function addonDisplayName(addon: CatalogAddon, t: T): string {
    switch (addonKind(addon)) {
        case "family_places": return t("billing.label.plusOneFamilyPlace");
        case "ai_photos": return t("billing.label.plusNPhotos", { n: formatNumber(addon.ai_units ?? 0) });
        case "ai_documents": return t("billing.label.plusNDocuments", { n: formatNumber(addon.ai_units ?? 0) });
        default: return addon.name;
    }
}
