import type { MessageKey } from '@/i18n/keys';

/**
 * The facts the plan chooser prints beside the prices: what a size holds and
 * what every paid plan includes. Each figure is a copy of a shipped value on
 * the marketing site's pricing comparison (src/lib/pricing-page.ts at the
 * monorepo root) and included.unit.test.ts fails when the two drift. Smart
 * Search limits are NOT here: they come from the catalog API per plan.
 */

/** About 4 MB per phone photo - rough on purpose, and the sentence says "about". */
export const PHOTO_BYTES = 4 * 1024 * 1024;

/** 125,000 reads as "about 125,000"; nobody believes a precise photo count. */
export function approxPhotos(bytes: number): number {
    return Math.floor(bytes / PHOTO_BYTES / 5000) * 5000;
}

/** One line per named size, saying who it fits. The sizes above Business have none. */
export const PLAN_FITS: Record<string, MessageKey> = {
    starter: 'billing.description.fitsStarter',
    plus: 'billing.description.fitsPlus',
    pro: 'billing.description.fitsPro',
    business: 'billing.description.fitsBusiness',
};

export const INCLUDED_FACTS = {
    /** Active share links at a time on Free; paid is unlimited. */
    freeShareLinks: 5,
    /** Share-link downloads on Free, fair use per day; paid is unmetered. */
    freeEgressGbPerDay: 10,
    /** Family places included with every paid plan. */
    familyPlaces: 5,
    trashDays: 30,
    activityDays: 400,
    /** Free keeps versions, trash and activity this long. */
    freeHistoryDays: 7,
    freeWorkspaces: 3,
    freeMembersPerWorkspace: 5,
    apiKeys: 20,
    webhooksPerWorkspace: 16,
    regions: 46,
    ticketResponseBusinessDays: 2,
    /** The largest size sold at checkout; past it, talk to us. */
    selfServeMaxTb: 20,
} as const;

export const PRICING_COMPARE_URL = 'https://dosya.dev/pricing/#differences';
export const TALK_TO_US_URL = 'https://dosya.dev/contact/?topic=sales&subject=Storage%20over%2020%20TB';
