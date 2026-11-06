import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, KeyRound, type LucideIcon } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';

export function IntegrationLayout({
  icon: Icon, iconSrc, badge: Badge, title, description, children, wide = false,
}: {
  icon: LucideIcon;
  iconSrc?: string;
  /** Small icon on the corner of the logo tile (see IntegrationMeta.badge). */
  badge?: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
  /** Room for a tool page (a wizard beside a listing) rather than a setup guide's reading measure. */
  wide?: boolean;
}) {
  const t = useT();
  return (
    <div className={`mx-auto w-full ${wide ? 'max-w-5xl' : 'max-w-3xl'} px-4 py-6`}>
      <Link
        to="/integrations"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5 rtl:-scale-x-100" /> {t('common.action.integrations')}
      </Link>
      <div className="mb-6 flex items-start gap-3">
        <div className="relative flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          {iconSrc ? <img src={iconSrc} alt="" className="size-5" /> : <Icon className="size-5" />}
          {Badge && (
            <span aria-hidden className="absolute -end-1.5 -bottom-1.5 flex size-5 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground">
              <Badge className="size-3" strokeWidth={2.25} />
            </span>
          )}
        </div>
        <div>
          <h1 className="text-lg font-semibold leading-tight">{title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * `usage` names where the key is actually pasted. It defaults to the code
 * snippets, which is true of every protocol page here, but not of a page whose
 * walkthrough has none: Zapier asks for the key in its own connection dialog,
 * and pointing that reader at "the snippets below" sends them looking for
 * something that is not on the page.
 */
export function ApiKeyCallout({ usage }: { usage?: ReactNode } = {}) {
  const t = useT();
  // The message joins "{link1} {usageThenUse}" with a space. Where the usage sentence
  // continues the first one (it starts with a comma), that space is dropped so the
  // comma follows the link; other languages get the usage as its own sentence.
  const raw = t('common.description.generateAEmphasis1KeyInLink1Usagethenuse');
  const continuation = raw.includes('{link1} {usageThenUse}');
  const message = continuation ? raw.replace('{link1} {usageThenUse}', '{link1}{usageThenUse}') : raw;
  const sentence = (node: ReactNode): ReactNode => {
    if (continuation || typeof node !== 'string') return node;
    const bare = node.replace(/^,\s*/, '');
    return bare.charAt(0).toUpperCase() + bare.slice(1);
  };
  const defaultUsage = richText(
    t(continuation
      ? 'common.description.thenUseItWhereTheSnippetsBelowSay'
      : 'common.description.thenUseItWhereTheSnippetsBelowSayLowercase'),
    { apiKeyExample: <code className="text-[11px] text-foreground">dos_your_api_key</code> },
  );
  return (
    <div className="mb-6 flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
      <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="text-sm">
        <p className="font-medium">{t('common.label.youRsquoLlNeedAnApiKey')}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {richText(message, {
            emphasis1: <code className="text-[11px] text-foreground">dos_…</code>,
            link1: (
              <Link
                to="/profile/api"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {t('common.action.profileApiKeys')}
              </Link>
            ),
            usageThenUse: usage === undefined ? defaultUsage : sentence(usage),
          })}
        </p>
      </div>
    </div>
  );
}

export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[11px]">
          {n}
        </span>
        {title}
      </h2>
      <div className="space-y-2 text-sm text-muted-foreground [&_code]:text-[11px] [&_code]:text-foreground">
        {children}
      </div>
    </section>
  );
}
