/**
 * Unit 7cp (pages cleanup): the search status badges, the referral invitation
 * sentence, the share-link meta lines, the dashboard usage line and the
 * checkout and storage eyebrows read from the corrected catalog keys, in
 * Turkish with no leftover English and in English byte for byte as before.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';
import type { Locale } from '@/i18n/locales';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
const referralsMock = vi.fn();
vi.mock('@/api/referrals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/referrals')>();
  return { ...actual, getReferralSummary: (...a: unknown[]) => referralsMock(...a) };
});

const { default: SearchPage } = await import('@/pages/search');
const { default: ReferralsPage } = await import('@/pages/referrals');
const { useWorkspace } = await import('@/stores/workspace');
const tr = (await import('@/i18n/messages/tr.json')).default as Record<string, string>;
const enMessages = (await import('@/i18n/messages/en.json')).default as Record<string, string>;

let shown: Rendered | null = null;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  useWorkspace.setState({ activeId: 'ws_1' });
  apiMock.mockReset();
  referralsMock.mockReset();
});
afterEach(() => {
  shown?.unmount();
  shown = null;
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function show(ui: React.ReactElement, locale: Locale) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  shown = await renderInLocale(
    <QueryClientProvider client={client}><MemoryRouter initialEntries={['/search?q=abc']}>{ui}</MemoryRouter></QueryClientProvider>,
    locale,
  );
  await flush();
  await flush();
  return shown;
}

const SEARCH = {
  ok: true,
  files: [],
  folders: [],
  shared: ['active', 'expiring', 'expired', 'revoked'].map((status, i) => ({
    link_id: `l${i}`, file_name: `f${i}.txt`, folder_name: null, view_count: 4, sharer_name: null, shared_at: 1, status,
  })),
  file_requests: [
    { id: 'r1', title: 'One', upload_count: 2, created_by_name: null, created_at: 1, is_revoked: false },
    { id: 'r2', title: 'Two', upload_count: 2, created_by_name: null, created_at: 1, is_revoked: true },
  ],
  pagination: { total_files: 0, total_folders: 0, total_shares: 4, total_requests: 2 },
};

const SUMMARY = {
  code: 'abc123', link: 'https://app.dosya.dev/sign-up?ref=abc123', credited_count: 1, max_rewards: 5,
  bonus_bytes: 5368709120, bonus_label: '5 GB', friends: [],
};

describe('search status badges', () => {
  it('Turkish: share and file request statuses translate', async () => {
    apiMock.mockResolvedValue(SEARCH);
    const r = await show(<SearchPage />, 'tr');
    const text = r.container.textContent ?? '';
    expect(text).toContain(tr['search.label.active']);
    expect(text).toContain(tr['search.label.revoked']);
    expect(text).toContain(tr['common.status.expired'].toLocaleLowerCase('tr'));
    expect(text).toContain(tr['shared.label.expiring'].toLocaleLowerCase('tr'));
    expect(r.leftover()).toEqual([]);
  });

  it('English: the lowercase words are unchanged', async () => {
    apiMock.mockResolvedValue(SEARCH);
    const r = await show(<SearchPage />, 'en');
    const badges = [...r.container.querySelectorAll('[data-slot="badge"], span')].map((e) => e.textContent);
    for (const word of ['active', 'expiring', 'expired', 'revoked']) expect(badges).toContain(word);
  });
});

describe('referral invitation sentence', () => {
  it('Turkish: carries the friend cap and the total in GB from the corrected key', async () => {
    referralsMock.mockResolvedValue(SUMMARY);
    const r = await show(<ReferralsPage />, 'tr');
    const expected = tr['referrals.description.inviteAFriendAndEarn5GbMaxfriendsTotalgb']
      .replace('{maxFriends}', '5').replace('{totalGb}', '25').replace(/(\d) (GB|MB)\b/g, '$1 $2');
    expect(r.container.textContent).toContain(expected);
    expect(r.leftover()).toEqual([]);
  });

  it('English: reads as before', async () => {
    referralsMock.mockResolvedValue(SUMMARY);
    const r = await show(<ReferralsPage />, 'en');
    expect(r.container.textContent).toContain('Invite a friend and earn 5 GB once they start using dosya - up to 5 friends (25 GB total).');
  });
});

describe('corrected keys the pages now read', () => {
  it('every key wired by this unit exists in English and Turkish', () => {
    const keys = [
      'share-analytics.description.hassizeHasregionSharedByLinkisMineLinkcreatedAt',
      'share-analytics.description.revokedFormattedvalueHascreatorLinkisMine',
      'shared.description.hassizeSharedLsharedAt',
      'dashboard.description.stotalBytesOfHascapUsed',
      'dashboard.description.mfileCountPluralMtotalBytes',
      'files.description.deleteSelectedsummary',
      'files.description.permanentlyDeleteSelectedsummary',
      'files.error.deletedDeletedFailFailedHasnote',
      'files.error.permanentlyDeleteDeletetargetnameHasfilesThisCannotBeUndone',
      'file-requests.description.createdRcreatedAtHascreator',
      'file-request-detail.description.uploadscountPluralHasexpiryHascreator',
      'billing.description.grantproviderHasintervalRedeemedGrantlinkedAt',
      'integrations-desktop.description.onDebianOrUbuntuTheLink1Hasdebsize',
      'integrations-lightroom.heading.revokeHastarget',
      'integrations-wordpress.description.showingSitescountOfTotalSites',
      'profile.description.scheduledForDaysPluralLaterSoYouCanCancelDeletes',
      'profile.description.dosyaDevRecoveryCodesFile',
      'connect-ai.description.verifiedCredirecthostHasby',
      'connect-lightroom.description.allowRequestdeviceNameHasplugin',
      'connect-lightroom.description.requestdeviceNameLightroomIsConnectedHasworkspace',
      'upload.action.folderdonecountFolderfilecountFilesFoldertotalbytes',
    ];
    for (const key of keys) {
      expect(enMessages[key], key).toBeTruthy();
      expect(tr[key], key).toBeTruthy();
    }
  });
});
