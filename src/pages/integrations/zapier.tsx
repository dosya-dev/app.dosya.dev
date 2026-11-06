import type { CSSProperties } from 'react';
import { ExternalLink } from 'lucide-react';
import { IntegrationLayout, ApiKeyCallout, Step } from '@/components/integrations/integration-layout';
import { getIntegration, ZAPIER_INVITE_URL } from '@/lib/integrations';
import { ZAPIER_BRAND } from '@/lib/zapier-brand';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';

const meta = getIntegration('zapier')!;

/*
 * Setup guide for the Zapier integration.
 *
 * Deliberately not a feature list: the catalogue of triggers, actions and
 * searches lives on the marketing page, which a unit test keeps in step with
 * apps/zapier. Repeating it here would make a third copy with nothing holding
 * it to the other two. This page answers the one question the card raises,
 * which is how to connect, the same way every other page under
 * /integrations/ does.
 *
 * Step 2 exists only because the app is private. When Zapier approves it for
 * the directory the step becomes "search for dosya", and ZAPIER_INVITE_URL
 * can go.
 */
export default function ZapierSetup() {
  const t = useT();
  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      {/* This walkthrough has no code blocks: Zapier asks for the key in its
          own connection dialog, so the default "the snippets below" would
          send the reader hunting for something that is not here. */}
      <ApiKeyCallout usage={t('integrations-zapier.description.thenPasteItWhenZapierAsksYouTo')} />

      <Step n={1} title={t('integrations-zapier.tooltip.addDosyaToYourZapierAccount')}>
        <p>{t('integrations-zapier.description.dosyaIsNotInZapierRsquoSPublicAppDirectoryYetSoSearching')}</p>
        {/* The one step nobody can skip, and the only way into a private app,
            so it is the page's loudest element rather than a text link in a
            paragraph. Zapier's own orange, because a reader who has just been
            told to go to Zapier should see Zapier. Graphite rather than white
            on it: see ZAPIER_BRAND.INK for the contrast arithmetic. */}
        <div className="mt-4 flex justify-center">
          <a
            href={ZAPIER_INVITE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-[var(--zap)] px-5 text-sm font-semibold shadow-sm transition-colors hover:bg-[var(--zap-hover)]"
            // Through variables so the hover state can be a Tailwind class and
            // no colour literal lands outside zapier-brand.ts.
            style={{
              '--zap': ZAPIER_BRAND.ORANGE,
              '--zap-hover': ZAPIER_BRAND.ORANGE_HOVER,
              color: ZAPIER_BRAND.INK,
            } as CSSProperties}
          >
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
              <path fill="currentColor" d={ZAPIER_BRAND.PATH} />
            </svg>
            {t('integrations-zapier.action.openTheZapierInvite')}
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </Step>

      <Step n={2} title={t('integrations-zapier.tooltip.connectYourAccount')}>
        <p>
          {richText(t('integrations-zapier.description.addAnyDosyaStepToAZapTheFirstTimeZapier'), {
            emphasis1: <code>dos_&hellip;</code>,
          })}
        </p>
      </Step>

      <Step n={3} title={t('integrations-zapier.tooltip.buildAZap')}>
        <p>{t('integrations-zapier.description.pickATriggerPickWhatHappensNextAndTurnItOn')}</p>
        <p>{t('integrations-zapier.description.aNewFileInAWorkspaceCanStartAZapAnd')}</p>
      </Step>

      <Step n={4} title={t('integrations-zapier.tooltip.everythingItCanDo')}>
        <p>
          {richText(t('integrations-zapier.description.theLink1ListsEveryTriggerActionAndSearchWithWorkedExamples'), {
            link1: (
              <a
                href={meta.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {t('integrations-zapier.action.zapierIntegrationPage')}
              </a>
            ),
          })}
        </p>
      </Step>
    </IntegrationLayout>
  );
}
