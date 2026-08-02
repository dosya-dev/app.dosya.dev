import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  /** One line on what this view is for. Skip it when the title says everything. */
  description?: string;
  /** Buttons or links. Omitted entirely when there is no useful action. */
  actions?: ReactNode;
}

/**
 * The one empty state in the app.
 *
 * Every empty view used to be a dead end - a line of grey text and nothing to
 * do. Sharing one primitive keeps the five of them from drifting into five
 * different layouts and five different tones.
 */
export function EmptyState({ icon: Icon, title, description, actions }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <Icon className="size-12 text-muted-foreground/30 mb-4" />
      <p className="text-sm font-medium text-foreground mb-1">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground max-w-80 mb-4">{description}</p>
      )}
      {actions && (
        <div data-testid="empty-state-actions" className="flex items-center gap-2 mt-1">
          {actions}
        </div>
      )}
    </div>
  );
}
