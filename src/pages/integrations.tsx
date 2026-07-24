import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { INTEGRATIONS } from '@/lib/integrations';

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
          <Link
            key={it.slug}
            to={`/integrations/${it.slug}`}
            className="group flex flex-col rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-muted/30"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                <it.icon className="size-[18px]" />
              </div>
              <ArrowRight className="size-4 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
            </div>
            <p className="text-sm font-semibold">{it.title}</p>
            <p className="mt-1 flex-1 text-xs text-muted-foreground">{it.description}</p>
            <span className="mt-3 inline-flex w-fit items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {it.tag}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
