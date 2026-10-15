import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { IntegrationLayout, Step } from '@/components/integrations/integration-layout';
import { getIntegration } from '@/lib/integrations';
import {
  EXTENSION_STORES, detectBrowser, getStore, FALLBACK_STORE,
  type BrowserSlug, type ExtensionStore,
} from '@/lib/browser-extension';

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
  const [slug, setSlug] = useState<BrowserSlug>('chrome');

  useEffect(() => setSlug(detectBrowser(navigator.userAgent)), []);

  const mine = getStore(slug);
  const others = EXTENSION_STORES.filter((s) => s.slug !== slug);

  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      <Step n={1} title={mine.published ? `Add it to ${mine.browser}` : `Not on ${mine.browser} yet`}>
        {mine.published ? (
          <>
            <p>It installs from the {mine.storeName} like any other extension.</p>
            <p>
              <StoreButton store={mine} />
            </p>
          </>
        ) : (
          <>
            <p>
              The {mine.browser} listing is submitted and waiting on review, so there is nothing
              to install there yet. {FALLBACK_STORE.browser} is live today, and the extension
              behaves the same in every browser once it is on.
            </p>
            <p>
              <StoreButton store={FALLBACK_STORE} />
            </p>
          </>
        )}

        <p className="text-xs text-muted-foreground">
          Other browsers:{' '}
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
                <span title={`${s.storeName} listing in review`}>{s.browser} (in review)</span>
              )}
            </span>
          ))}
        </p>
      </Step>

      <Step n={2} title="Sign in once">
        <p>
          Open the extension and sign in with your dosya account. It uses the same session as this
          tab, so there is no key to paste and nothing to configure.
        </p>
      </Step>

      <Step n={3} title="Save anything you can right-click">
        <p>
          Right-click an image, a selection, or the page itself and choose <strong>Save image</strong>,{' '}
          <strong>Save selection as text</strong> or <strong>Save visible screenshot</strong>. Each
          one lands straight in a dosya folder you pick, without a download and re-upload.
        </p>
        <p>
          The{' '}
          <a
            href={meta.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            extension page
          </a>{' '}
          covers what it can capture, the size limit and exactly which permissions it asks for.
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
