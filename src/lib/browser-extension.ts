/**
 * "Save to dosya", the browser extension, as this app needs to describe it.
 *
 * Duplicated from the marketing site's src/lib/extension-stores.ts, which
 * cannot be imported across the app seam. browser-extension.test.ts reads
 * that file and compares every field below, because the one that matters
 * changes without warning:
 *
 *   A LISTING URL AND A PUBLISHED LISTING ARE TWO DIFFERENT THINGS. Each URL
 *   here is the address its store WILL serve, but a listing still in review
 *   answers it with a 404. So a store becomes a link only when `published`
 *   is true, and approval is one boolean. A stale copy of that boolean sends
 *   people to a 404, or hides a store that went live.
 *
 * Detection has its own trap, the same shape as the one in desktop-os.ts:
 * Edge's user agent contains "Chrome", and every Chromium user agent
 * contains "Safari". Test Edge first, then Firefox, then Chrome, and let
 * Safari fall out as the remainder.
 */

import { t } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';

export type BrowserSlug = 'chrome' | 'firefox' | 'edge' | 'safari';

export interface ExtensionStore {
	slug: BrowserSlug;
	/** What the reader calls their browser (translated when read). */
	readonly browser: string;
	/** What the vendor calls the place it lives (translated when read). */
	readonly storeName: string;
	/** The address the store will serve. Only safe to link when published. */
	listingUrl: string;
	/** False while the listing is still in review, when that URL 404s. */
	published: boolean;
	logo: string;
	/** The button text (translated when read). */
	readonly cta: string;
}

/** The table holds catalog keys; the three display strings translate when read. */
function store(
	base: Omit<ExtensionStore, 'browser' | 'storeName' | 'cta'>,
	keys: { browser: MessageKey; storeName: MessageKey; cta: MessageKey },
): ExtensionStore {
	return {
		...base,
		get browser() { return t(keys.browser); },
		get storeName() { return t(keys.storeName); },
		get cta() { return t(keys.cta); },
	};
}

/** Chrome first: largest share, and the one listing that is certainly live. */
export const EXTENSION_STORES: ExtensionStore[] = [
	store(
		{
			slug: 'chrome',
			listingUrl:
				'https://chromewebstore.google.com/detail/save-to-dosya/dkedbgjibdhomlepbbobfobmcgjgimem',
			published: true,
			logo: '/browsers/chrome.svg',
		},
		{ browser: 'common.label.chrome', storeName: 'integrations-extension.label.chromeWebStore', cta: 'integrations-extension.label.addForChrome' },
	),
	store(
		{
			slug: 'firefox',
			listingUrl: 'https://addons.mozilla.org/en-US/firefox/addon/save-to-dosya/',
			published: true,
			logo: '/browsers/firefox.svg',
		},
		{ browser: 'common.label.firefox', storeName: 'integrations-extension.label.firefoxAddOns', cta: 'integrations-extension.label.addForFirefox' },
	),
	store(
		{
			slug: 'edge',
			listingUrl: 'https://microsoftedge.microsoft.com/addons/detail/dapdhleiinckjcmlfnooelpaneahhnaf',
			published: true,
			logo: '/browsers/edge.svg',
		},
		{ browser: 'common.label.edge', storeName: 'integrations-extension.label.edgeAddOns', cta: 'integrations-extension.label.addForEdge' },
	),
	store(
		{
			slug: 'safari',
			listingUrl: 'https://apps.apple.com/app/id6820120081',
			published: true,
			logo: '/browsers/safari.svg',
		},
		{ browser: 'common.label.safari', storeName: 'common.label.macAppStore', cta: 'integrations-extension.label.addForSafari' },
	),
];

/**
 * The reader's browser.
 *
 * Falls back to Chrome rather than null: unlike a desktop binary, guessing
 * wrong here costs nothing (every store is one click away on the page) and
 * Chrome is both the largest share and the default listing.
 */
export function detectBrowser(userAgent: string): BrowserSlug {
	if (/Edg\//.test(userAgent)) return 'edge';
	if (/Firefox\//.test(userAgent)) return 'firefox';
	if (/Chrome\/|Chromium\//.test(userAgent)) return 'chrome';
	if (/Safari\//.test(userAgent)) return 'safari';
	return 'chrome';
}

export function getStore(slug: BrowserSlug): ExtensionStore {
	return EXTENSION_STORES.find((s) => s.slug === slug)!;
}

/** The store to push when the reader's own browser has no live listing yet. */
export const FALLBACK_STORE = EXTENSION_STORES[0];
