/**
 * The legal notice shown on the authentication pages.
 *
 * Kept in one place because every entry point into an account has to carry it
 * and the wording must not drift between them. Both documents are named: the
 * Terms are the contract, but the Privacy Policy is the notice that has to be
 * given at the point personal data is collected, and a sign-up form is exactly
 * that point. Linking only the Terms leaves that notice ungiven.
 */

import { Fragment, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';

export const TERMS_URL = 'https://dosya.dev/terms-of-service';
export const PRIVACY_URL = 'https://dosya.dev/privacy-policy';

/**
 * `noreferrer` is not cosmetic here: these open from inside the authenticated
 * app, and `target=_blank` without it hands the opened document a
 * `window.opener` handle back to this one.
 */
function LegalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium underline underline-offset-4 hover:text-foreground"
    >
      {children}
    </a>
  );
}

const SLOT_1 = '\u0001';
const SLOT_2 = '\u0002';

/** A message with {link1} and {link2}: the links sit where the message puts them, so a language can reorder them. */
function withLinks(message: string, link1: ReactNode, link2: ReactNode): ReactNode {
  const out: ReactNode[] = [];
  let rest = message;
  for (const [slot, node] of [[SLOT_1, link1], [SLOT_2, link2]] as const) {
    const at = rest.indexOf(slot);
    if (at === -1) continue;
    out.push(rest.slice(0, at), node);
    rest = rest.slice(at + 1);
  }
  out.push(rest);
  return out.map((part, i) => <Fragment key={i}>{part}</Fragment>);
}

/** Inline sentence naming both documents. Used inside the sign-up consent checkbox. */
export function LegalLinks() {
  const t = useT();
  return (
    <>
      {withLinks(
        t('common.label.link1AndAcknowledgeTheLink2', { link1: SLOT_1, link2: SLOT_2 }),
        <LegalLink href={TERMS_URL}>{t('common.action.termsOfService')}</LegalLink>,
        <LegalLink href={PRIVACY_URL}>{t('common.action.privacyPolicy')}</LegalLink>,
      )}
    </>
  );
}

/**
 * Passive notice for pages with no checkbox to tick - the login form and the
 * OAuth buttons above it. Continuing past it is the act of agreement.
 */
export function LegalNotice({ className = '' }: { className?: string }) {
  const t = useT();
  return (
    <p className={`text-center text-xs text-muted-foreground ${className}`}>
      {withLinks(
        t('common.description.byContinuingYouAgreeToOurLink1AndLink2', { link1: SLOT_1, link2: SLOT_2 }),
        <LegalLink href={TERMS_URL}>{t('common.action.termsOfService')}</LegalLink>,
        <LegalLink href={PRIVACY_URL}>{t('common.action.privacyPolicy')}</LegalLink>,
      )}
    </p>
  );
}
