import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { IntegrationLayout, Step } from '@/components/integrations/integration-layout';
import { getIntegration } from '@/lib/integrations';
import {
  EXTENSION_STORES, detectBrowser, getStore, FALLBACK_STORE,
  type BrowserSlug, type ExtensionStore,
} from '@/lib/browser-extension';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';

const meta = getIntegration('extension')!;

/*
 * "Save to dosya", the browser extension.
 *
 * The rule this page is built around is in lib/browser-extension.ts: a
 * listing URL and a published listing are two different things, and an
 * unpublished one answers its own address with a 404. So an unpublished
 * store is named but never linked, and the reader is pointed at the one
 * that works instead of being dropped on an error page.
 *
 * Store availability follows the marketing catalog. Pending entries retain
 * a fallback until their installation links are enabled.
 */
export default function ExtensionSetup() {
  const t = useT();
  const [slug, setSlug] = useState<BrowserSlug>('chrome');

  useEffect(() => setSlug(detectBrowser(navigator.userAgent)), []);

  const mine = getStore(slug);
  const others = EXTENSION_STORES.filter((s) => s.slug !== slug);

  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      <Step n={1} title={mine.published
        ? t('integrations-extension.tooltip.addItToMinebrowser', { mineBrowser: mine.browser })
        : t('integrations-extension.tooltip.notOnMinebrowserYet', { mineBrowser: mine.browser })}>
        {mine.published ? (
          <>
            <p>{t('integrations-extension.description.itInstallsFromTheMinestorenameLikeAnyOtherExtension', { mineStoreName: mine.storeName })}</p>
            <p>
              <StoreButton store={mine} />
            </p>
          </>
        ) : (
          <>
            <p>
              {t('integrations-extension.description.theMinebrowserListingIsSubmittedAndWaitingOnReviewSoThere', {
                mineBrowser: mine.browser,
                FALLBACK_STOREBrowser: FALLBACK_STORE.browser,
              })}
            </p>
            <p>
              <StoreButton store={FALLBACK_STORE} />
            </p>
          </>
        )}

        <p className="text-xs text-muted-foreground">
          {t('integrations-extension.label.otherBrowsers')}{' '}
          {others.map((s, i) => (
            <span key={s.slug}>
              {i > 0 && ' · '}
              {s.published ? (
                <a
                  href={s.listingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {s.browser}
                </a>
              ) : (
                // Named, not linked: this URL 404s until the store approves it.
                <span title={t('integrations-extension.tooltip.sstorenameListingInReview', { sStoreName: s.storeName })}>{t('integrations-extension.label.sbrowserInReview', { sBrowser: s.browser })}</span>
              )}
            </span>
          ))}
        </p>
      </Step>

      <Step n={2} title={t('integrations-extension.tooltip.signInOnce')}>
        <p>{t('integrations-extension.description.openTheExtensionAndSignInWithYourDosyaAccountIt')}</p>
      </Step>

      <Step n={3} title={t('integrations-extension.tooltip.saveAnythingYouCanRightClick')}>
        <p>
          {richText(t('integrations-extension.description.rightClickAnImageASelectionOrThePageItselfAndChoose'), {
            emphasis1: <strong>{t('integrations-extension.label.saveImage')}</strong>,
            emphasis2: <strong>{t('integrations-extension.label.saveSelectionAsText')}</strong>,
            emphasis3: <strong>{t('integrations-extension.label.saveVisibleScreenshot')}</strong>,
          })}
        </p>
        <p>
          {richText(t('integrations-extension.description.theLink1CoversWhatItCanCaptureTheSizeLimitAnd'), {
            link1: (
              <a
                href={meta.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {t('integrations-extension.action.extensionPage')}
              </a>
            ),
          })}
        </p>
      </Step>
    </IntegrationLayout>
  );
}

function StoreButton({ store }: { store: ExtensionStore }) {
  return (
    <a
      href={store.listingUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
    >
      <img src={store.logo} alt="" width={18} height={18} className="size-4.5" />
      {store.cta}
      <ExternalLink className="size-3.5 opacity-70" />
    </a>
  );
}
