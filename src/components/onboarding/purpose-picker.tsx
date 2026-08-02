import { HardDrive, Terminal, Users, Image } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Purpose } from './steps';

interface PurposePickerProps {
  onPick: (purpose: Purpose) => void;
  onSkip: () => void;
}

const OPTIONS: { id: Purpose; label: string; blurb: string; icon: LucideIcon }[] = [
  { id: 'personal', label: 'Personal backup', blurb: 'Keep my own files safe', icon: HardDrive },
  { id: 'dev', label: 'Dev and infra', blurb: 'Storage for code and services', icon: Terminal },
  { id: 'team', label: 'Team drive', blurb: 'Share files with other people', icon: Users },
  { id: 'media', label: 'Media library', blurb: 'Photos, video and audio', icon: Image },
];

/**
 * One question, four answers, one tap. It exists to tailor the checklist -
 * a backend engineer and a photographer need different next steps, and a
 * checklist that hedges between them helps neither.
 *
 * Skipping is a first-class outcome, not a hidden escape: an unanswered
 * purpose falls through to the generic step set, which is a perfectly good
 * list.
 */
export function PurposePicker({ onPick, onSkip }: PurposePickerProps) {
  return (
    <div>
      <p className="text-sm font-medium mb-1">What will you use dosya for?</p>
      <p className="text-xs text-muted-foreground mb-3">
        This only tailors the suggestions below. You can change direction any time.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            data-testid={`purpose-${o.id}`}
            onClick={() => onPick(o.id)}
            className="flex flex-col items-start gap-1.5 p-3 rounded-lg border text-left hover:bg-muted/50 hover:border-foreground/20 transition-colors"
          >
            <o.icon className="size-4 text-muted-foreground" />
            <span className="text-xs font-medium">{o.label}</span>
            <span className="text-[11px] text-muted-foreground leading-tight">{o.blurb}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        data-testid="purpose-skip"
        onClick={onSkip}
        className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Skip this
      </button>
    </div>
  );
}
