import type { CSSProperties } from 'react';
import { ExternalLink } from 'lucide-react';
import { IntegrationLayout, ApiKeyCallout, Step } from '@/components/integrations/integration-layout';
import { getIntegration, ZAPIER_INVITE_URL } from '@/lib/integrations';
import { ZAPIER_BRAND } from '@/lib/zapier-brand';

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
  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      {/* This walkthrough has no code blocks: Zapier asks for the key in its
          own connection dialog, so the default "the snippets below" would
          send the reader hunting for something that is not here. */}
      <ApiKeyCallout usage=", then paste it when Zapier asks you to connect a dosya account." />

      <Step n={1} title="Add dosya to your Zapier account">
        <p>
          dosya is not in Zapier&rsquo;s public app directory yet, so searching for it there will not
          find it. This link adds it to your own account instead. It works on any Zapier plan,
          including the free one, and nobody else sees it there.
        </p>
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
            Open the Zapier invite
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </Step>

      <Step n={2} title="Connect your account">
        <p>
          Add any dosya step to a Zap. The first time, Zapier asks for an API key: paste the{' '}
          <code>dos_&hellip;</code> key from above. Zapier checks it immediately, so a bad key fails
          there rather than halfway through your first run.
        </p>
      </Step>

      <Step n={3} title="Build a Zap">
        <p>
          Pick a trigger, pick what happens next, and turn it on. Zapier does the watching, so there
          is nothing to install here and nothing to keep running.
        </p>
        <p>
          A new file in a workspace can start a Zap, and it fires however the file arrived: a drag
          into this browser tab, an rclone sync, a drop over SFTP. Overwriting an existing file does
          not count as new, so a re-upload will not fire it twice.
        </p>
      </Step>

      <Step n={4} title="Everything it can do">
        <p>
          The{' '}
          <a
            href={meta.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Zapier integration page
          </a>{' '}
          lists every trigger, action and search, with worked examples.
        </p>
      </Step>
    </IntegrationLayout>
  );
}
