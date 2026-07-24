import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, KeyRound, type LucideIcon } from 'lucide-react';

export function IntegrationLayout({
  icon: Icon, iconSrc, title, description, children,
}: {
  icon: LucideIcon;
  iconSrc?: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <Link
        to="/integrations"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Integrations
      </Link>
      <div className="mb-6 flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          {iconSrc ? <img src={iconSrc} alt="" className="size-5" /> : <Icon className="size-5" />}
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

export function ApiKeyCallout() {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
      <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="text-sm">
        <p className="font-medium">You&rsquo;ll need an API key</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Generate a <code className="text-[11px] text-foreground">dos_…</code> key in{' '}
          <Link
            to="/profile#section-api"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Profile → API keys
          </Link>
          , then use it where the snippets below say{' '}
          <code className="text-[11px] text-foreground">dos_your_api_key</code>.
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
