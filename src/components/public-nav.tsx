import { useState } from 'react';
import { ArrowRight, Sun, Moon } from 'lucide-react';
import { withThemeSweep } from '@/lib/theme';
import { useSessionAccount, type SessionAccount } from '@/hooks/use-session-probe';
import { Logo } from "@/components/brand/logo";
import { LanguageMenu } from '@/components/language-menu';
import { useT } from '@/lib/i18n';

// Marketing navbar for public pages (login, etc.), ported from the Astro site's Menu.
// Centered rounded card, original logo + mono-italic wordmark, Pricing, CTA, theme toggle.
export function PublicNav({
  cta = 'login',
  account,
}: {
  cta?: 'login' | 'signup';
  /**
   * The probe the page already ran, where it has one. The login and sign-up
   * pages need the account for their already-signed-in dialog anyway, so they
   * hand it over rather than let this probe the same endpoint a second time.
   */
  account?: SessionAccount;
}) {
  const t = useT();
  // Called unconditionally (hook rules); `enabled` is what skips the request.
  const probed = useSessionAccount(account === undefined);
  const session = (account ?? probed).status;
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );
  const toggleTheme = () => {
    withThemeSweep(() => {
      const isDark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      setDark(isDark);
    });
  };
  const ctaClass = 'inline-flex items-center gap-1.5 h-9 px-3 sm:px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors';

  return (
    <nav className="max-w-[800px] mx-auto flex items-center justify-between gap-2 px-3 sm:px-6 py-3 bg-card border rounded-lg shadow-sm">
      <a href="/" aria-label="dosya.dev" className="flex min-w-0 items-center gap-2 font-mono italic font-semibold text-lg">
        <Logo className="h-8 w-8 shrink-0" />
        {/* Wordmark drops out below 380 px: with a long CTA label it was squeezed to a clipped sliver. The logo keeps the link recognisable. */}
        <span className="hidden min-[380px]:inline">dosya.dev</span>
      </a>

      <div className="flex shrink-0 items-center gap-1 sm:gap-6">
        <a href="https://dosya.dev/#pricing" className="hidden sm:inline text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          {t('common.action.pricing')}
        </a>
        {session === 'pending' ? (
          <span data-session-probe="pending" className="inline-block h-9 w-14 sm:w-[88px]" aria-hidden="true" />
        ) : session === 'in' ? (
          <a href="/" className={ctaClass} aria-label={t('common.action.openDashboard')} title={t('common.action.openDashboard')}>
            <span className="hidden sm:inline">{t('common.action.openDashboard')}</span>
            <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          </a>
        ) : (
          <a href={cta === 'signup' ? '/sign-up' : '/login'} className={ctaClass}>
            {cta === 'signup' ? t('common.action.signUp') : t('common.action.login')}
          </a>
        )}
        <LanguageMenu align="end" />
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={t('common.action.toggleTheme')}
          title={t('common.action.toggleTheme')}
          className="w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </nav>
  );
}
