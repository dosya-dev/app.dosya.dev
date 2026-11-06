import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CopyX, ExternalLink, MapPin, type LucideIcon } from 'lucide-react';
import { INTEGRATIONS } from '@/lib/integrations';
import { getBackends } from '@/api/rclone-import';
import { useWorkspace } from '@/stores/workspace';
import { t, useT } from '@/lib/i18n';

/** In-app tools surfaced here for discoverability - they live at their own
 *  routes (not /integrations/*), so they get a separate section below the
 *  protocol setup guides rather than an INTEGRATIONS entry. */
const TOOLS: { to: string; title: string; description: string; tag: string; icon: LucideIcon }[] = [
  {
    to: '/duplicates',
    get title() { return t('integrations.heading.duplicateFinder'); },
    get description() { return t('integrations.description.findByteIdenticalCopiesOfYourFilesAndMove'); },
    get tag() { return t('integrations.label.tool'); },
    icon: CopyX,
  },
  {
    to: '/map',
    get title() { return t('integrations.heading.photoMap'); },
    get description() { return t('integrations.description.seeYourGeotaggedPhotosOnAMapOfWhereTheyWere'); },
    get tag() { return t('integrations.label.tool'); },
    icon: MapPin,
  },
];

export default function IntegrationsPage() {
  const t = useT();
  const workspaceId = useWorkspace((s) => s.activeId);
  // Rollout-gated cards (remote-rclone) show once the API says the feature is
  // on for this user; a failed check keeps them hidden.
  const [rolloutOn, setRolloutOn] = useState(false);
  useEffect(() => {
    if (!workspaceId) return;
    let alive = true;
    getBackends(workspaceId).then((r) => { if (alive) setRolloutOn(r.enabled); }).catch(() => {});
    return () => { alive = false; };
  }, [workspaceId]);
  const visible = INTEGRATIONS.filter((it) => !it.rollout || rolloutOn);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">{t('common.heading.integrations')}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t('common.description.connectExternalToolsAndAppsToYourDosyaWorkspace')}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((it) => (
          <div
            key={it.slug}
            className="group relative flex flex-col rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-muted/30"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="relative flex size-9 items-center justify-center rounded-lg bg-muted">
                {it.iconSrc
                  ? <img src={it.iconSrc} alt="" className="size-4.5" />
                  : <it.icon className="size-4.5" />}
                {it.badge && (
                  <span aria-hidden className="absolute -end-1.5 -bottom-1.5 flex size-4.5 items-center justify-center rounded-full border border-card bg-primary text-primary-foreground">
                    <it.badge className="size-3" strokeWidth={2.25} />
                  </span>
                )}
              </div>
              {/* rtl-ok: mirrored, rtl: counterpart on the same element */}
              <ArrowRight className="size-4 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 rtl:translate-x-1 rtl:group-hover:translate-x-0 group-hover:opacity-100 rtl:-scale-x-100" />
            </div>
            <p className="text-sm font-semibold">{it.title}</p>
            <p className="mt-1 flex-1 text-xs text-muted-foreground">{it.description}</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
              <span title={it.tag} className="inline-block max-w-full truncate whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {it.tag}
              </span>
              {it.docsUrl && (
                <a
                  href={it.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="relative z-10 inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {t('integrations.action.readDocs')} <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            {/* Stretched primary link - opens the in-app setup page. It's the last
                child so it overlays the static content, but the "Read docs" anchor
                (z-10) stays above it and remains clickable. */}
            <Link
              to={`/integrations/${it.slug}`}
              className="absolute inset-0 rounded-xl"
              aria-label={t('integrations.action.openIttitleSetup', { title: it.title })}
            />
          </div>
        ))}
      </div>
      <div className="mb-3 mt-8">
        <h2 className="text-sm font-semibold">{t('integrations.heading.builtInTools')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('integrations.description.includedWithYourWorkspaceNoSetupNeeded')}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map((tool) => (
          <div
            key={tool.to}
            className="group relative flex flex-col rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-muted/30"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                <tool.icon className="size-4.5" />
              </div>
              {/* rtl-ok: mirrored, rtl: counterpart on the same element */}
              <ArrowRight className="size-4 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 rtl:translate-x-1 rtl:group-hover:translate-x-0 group-hover:opacity-100 rtl:-scale-x-100" />
            </div>
            <p className="text-sm font-semibold">{tool.title}</p>
            <p className="mt-1 flex-1 text-xs text-muted-foreground">{tool.description}</p>
            <div className="mt-3">
              <span title={tool.tag} className="inline-block max-w-full truncate whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {tool.tag}
              </span>
            </div>
            <Link to={tool.to} className="absolute inset-0 rounded-xl" aria-label={t('common.action.openStore', { title: tool.title })} />
          </div>
        ))}
      </div>
    </div>
  );
}
