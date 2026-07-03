import { useState } from 'react';
import { Sun, Moon } from 'lucide-react';

// Marketing navbar for public pages (login, etc.), ported from the Astro site's Menu.
// Centered rounded card, original logo + mono-italic wordmark, Pricing, CTA, theme toggle.
export function PublicNav({ cta = 'login' }: { cta?: 'login' | 'signup' }) {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );
  const toggleTheme = () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    setDark(isDark);
  };

  return (
    <nav className="max-w-[800px] mx-auto flex items-center justify-between px-6 py-3 bg-card border rounded-lg shadow-sm">
      <a href="/" className="flex items-center gap-2 font-mono italic font-semibold text-lg">
        <img src="/logo.svg" alt="dosya.dev logo" className="h-8 w-8" />
        dosya.dev
      </a>

      <div className="flex items-center gap-4 sm:gap-6">
        <a href="https://dosya.dev/#pricing" className="hidden sm:inline text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          Pricing
        </a>
        <a
          href={cta === 'signup' ? '/sign-up' : '/login'}
          className="inline-flex items-center h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          {cta === 'signup' ? 'Sign Up' : 'Login'}
        </a>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title="Toggle theme"
          className="w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </nav>
  );
}
