import { Link } from 'react-router-dom';
import { ArrowRight, CopyX, ExternalLink, MapPin, type LucideIcon } from 'lucide-react';
import { INTEGRATIONS } from '@/lib/integrations';

/** In-app tools surfaced here for discoverability - they live at their own
 *  routes (not /integrations/*), so they get a separate section below the
 *  protocol setup guides rather than an INTEGRATIONS entry. */
const TOOLS: { to: string; title: string; description: string; tag: string; icon: LucideIcon }[] = [
  {
    to: '/duplicates',
    title: 'Duplicate finder',
    description: 'Find byte-identical copies of your files and move the extras to trash.',
    tag: 'Tool',
    icon: CopyX,
  },
  {
    to: '/map',
    title: 'Photo map',
    description: 'See your geotagged photos on a map of where they were taken.',
    tag: 'Tool',
    icon: MapPin,
  },
];

export default function IntegrationsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">Integrations</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Connect external tools and apps to your dosya workspace.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS.map((it) => (
          <div
            key={it.slug}
            className="group relative flex flex-col rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-muted/30"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                {it.iconSrc
                  ? <img src={it.iconSrc} alt="" className="size-4.5" />
                  : <it.icon className="size-4.5" />}
              </div>
              <ArrowRight className="size-4 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
            </div>
            <p className="text-sm font-semibold">{it.title}</p>
            <p className="mt-1 flex-1 text-xs text-muted-foreground">{it.description}</p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="inline-flex w-fit items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {it.tag}
              </span>
              {it.docsUrl && (
                <a
                  href={it.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="relative z-10 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  Read docs <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            {/* Stretched primary link - opens the in-app setup page. It's the last
                child so it overlays the static content, but the "Read docs" anchor
                (z-10) stays above it and remains clickable. */}
            <Link
              to={`/integrations/${it.slug}`}
              className="absolute inset-0 rounded-xl"
              aria-label={`Open ${it.title} setup`}
            />
          </div>
        ))}
      </div>
      <div className="mb-3 mt-8">
        <h2 className="text-sm font-semibold">Built-in tools</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Included with your workspace - no setup needed.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map((t) => (
          <div
            key={t.to}
            className="group relative flex flex-col rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-muted/30"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                <t.icon className="size-4.5" />
              </div>
              <ArrowRight className="size-4 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
            </div>
            <p className="text-sm font-semibold">{t.title}</p>
            <p className="mt-1 flex-1 text-xs text-muted-foreground">{t.description}</p>
            <div className="mt-3">
              <span className="inline-flex w-fit items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t.tag}
              </span>
            </div>
            <Link to={t.to} className="absolute inset-0 rounded-xl" aria-label={`Open ${t.title}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
