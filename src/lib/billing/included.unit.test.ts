import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INCLUDED_FACTS, approxPhotos } from './included';

const GB = 1024 ** 3;
// The marketing site's comparison table, in the monorepo only (the deploy repo has apps/web alone).
const pricingPage = resolve(__dirname, '../../../../../src/lib/pricing-page.ts');

describe('approxPhotos', () => {
    it('counts about 4 MB a photo and rounds down to 5,000', () => {
        expect(approxPhotos(500 * GB)).toBe(125_000);
        expect(approxPhotos(100 * GB)).toBe(25_000);
        expect(approxPhotos(2 * 1024 * GB)).toBe(520_000);
    });
});

describe.skipIf(!existsSync(pricingPage))('included facts match the pricing comparison', () => {
    const src = readFileSync(pricingPage, 'utf8');
    const f = INCLUDED_FACTS;
    it.each([
        ['share links', `free: "${f.freeShareLinks} at a time"`],
        ['egress', `${f.freeEgressGbPerDay} GB/day`],
        ['trash', `paid: "${f.trashDays} days"`],
        ['activity', `paid: "${f.activityDays} days"`],
        ['free history', `free: "${f.freeHistoryDays} days"`],
        ['workspaces', `{ label: "Workspaces", free: "${f.freeWorkspaces}"`],
        ['members', `{ label: "Members per workspace", free: "${f.freeMembersPerWorkspace}"`],
        ['api keys', `{ label: "API keys", free: "3", paid: "${f.apiKeys}"`],
        ['webhooks', `paid: "${f.webhooksPerWorkspace} per workspace"`],
        ['family places', `paid: "${f.familyPlaces} included`],
        ['talk to us', `SELF_SERVE_MAX_TB = ${f.selfServeMaxTb};`],
    ])('%s', (_name, needle) => {
        expect(src).toContain(needle);
    });
});
