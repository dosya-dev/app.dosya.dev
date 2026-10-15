/**
 * Which desktop build a visitor should be offered, and what is true about it.
 *
 * The detection rules are the ones the marketing /desktop page already uses,
 * and they carry the same two traps, which is why this is a tested function
 * rather than three inline string checks:
 *
 *   An Android user agent contains "linux" and an iPad's contains "mac". A
 *   naive match hands a phone a 250 MB .dmg. Mobile is therefore detected
 *   FIRST and returns null, so the page can say "this is a desktop app"
 *   instead of steering someone at a binary they cannot run.
 *
 *   "Windows" must be tested before "mac" and "linux". Nothing in a Windows
 *   UA says mac, but the order is load-bearing the other way round once
 *   Chromium-brand tokens are in play, and testing in a fixed order costs
 *   nothing.
 *
 * Everything else here is DERIVED from the build manifest rather than
 * asserted, because each of these has already been wrong on a page that
 * hard-coded it: the mac build was arm64-only until it became universal, and
 * the snap sits on `candidate`, where a plain `snap install dosya` finds
 * nothing and fails.
 */

export type DesktopOs = 'windows' | 'mac' | 'linux';

/** The detected OS, or null for a phone, a tablet, or anything unrecognised. */
export function detectDesktopOs(userAgent: string): DesktopOs | null {
	const ua = userAgent.toLowerCase();
	// First, and deliberately: an Android UA says "linux", an iPad's says "mac".
	if (/android|iphone|ipad|ipod|mobile/.test(ua)) return null;
	if (ua.includes('windows')) return 'windows';
	if (ua.includes('mac')) return 'mac';
	if (ua.includes('linux')) return 'linux';
	return null;
}

/** True when the visitor is on a phone or tablet, as opposed to simply unknown. */
export function isHandheld(userAgent: string): boolean {
	return /android|iphone|ipad|ipod|mobile/.test(userAgent.toLowerCase());
}

export const OS_LABEL: Record<DesktopOs, string> = {
	windows: 'Windows',
	mac: 'macOS',
	linux: 'Linux',
};

/** The shape of GET /api/desktop/info that this page reads. */
export interface DesktopBuild {
	fileName?: string;
	size?: number;
	deb?: { fileName?: string; size?: number };
}

export interface DesktopInfo {
	ok?: boolean;
	version?: string;
	date?: string;
	builds?: Partial<Record<DesktopOs, DesktopBuild>>;
	channels?: { snap?: { channel?: string; version?: string } };
}

/**
 * What the shipped .dmg actually supports.
 *
 * electron-builder targets a universal build, but the manifest served an
 * arm64-only .dmg for several releases. Reading the file name means this
 * cannot promise Intel before Intel ships.
 */
export function macArchitecture(info: DesktopInfo | null): string {
	const name = info?.builds?.mac?.fileName;
	if (!name) return 'Apple Silicon';
	return /arm64/i.test(name) ? 'Apple Silicon' : 'Apple Silicon and Intel';
}

/**
 * The snap command that actually installs something.
 *
 * Null when the manifest carries no snap at all: the release workflow adds it
 * only once a revision has been uploaded, and offering the command before
 * then is offering a command that fails.
 */
export function snapInstallCommand(info: DesktopInfo | null): string | null {
	const snap = info?.channels?.snap;
	if (!snap) return null;
	return snap.channel && snap.channel !== 'stable'
		? `sudo snap install dosya --${snap.channel}`
		: 'sudo snap install dosya';
}

/** Human size for a build, or null when the manifest did not carry one. */
export function buildSize(bytes: number | undefined): string | null {
	if (!bytes || bytes <= 0) return null;
	const mb = bytes / 1_000_000;
	return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
