/**
 * The legal notice shown on the authentication pages.
 *
 * Kept in one place because every entry point into an account has to carry it
 * and the wording must not drift between them. Both documents are named: the
 * Terms are the contract, but the Privacy Policy is the notice that has to be
 * given at the point personal data is collected, and a sign-up form is exactly
 * that point. Linking only the Terms leaves that notice ungiven.
 */

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

/** Inline sentence naming both documents. Used inside the sign-up consent checkbox. */
export function LegalLinks() {
  return (
    <>
      <LegalLink href={TERMS_URL}>Terms of Service</LegalLink> and acknowledge the{' '}
      <LegalLink href={PRIVACY_URL}>Privacy Policy</LegalLink>
    </>
  );
}

/**
 * Passive notice for pages with no checkbox to tick - the login form and the
 * OAuth buttons above it. Continuing past it is the act of agreement.
 */
export function LegalNotice({ className = '' }: { className?: string }) {
  return (
    <p className={`text-center text-xs text-muted-foreground ${className}`}>
      By continuing, you agree to our <LegalLink href={TERMS_URL}>Terms of Service</LegalLink> and{' '}
      <LegalLink href={PRIVACY_URL}>Privacy Policy</LegalLink>.
    </p>
  );
}
