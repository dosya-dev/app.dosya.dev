import { HardDrive, Terminal, Users, Image } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { MessageKey } from '@/i18n/keys';
import { useT } from '@/lib/i18n';
import type { Purpose } from './steps';

interface PurposePickerProps {
  onPick: (purpose: Purpose) => void;
  onSkip: () => void;
}

const OPTIONS: { id: Purpose; labelKey: MessageKey; blurbKey: MessageKey; icon: LucideIcon }[] = [
  { id: 'personal', labelKey: 'dashboard.label.personalBackup', blurbKey: 'dashboard.label.keepMyOwnFilesSafe', icon: HardDrive },
  { id: 'dev', labelKey: 'dashboard.label.devAndInfra', blurbKey: 'dashboard.label.storageForCodeAndServices', icon: Terminal },
  { id: 'team', labelKey: 'dashboard.label.teamDrive', blurbKey: 'dashboard.label.shareFilesWithOtherPeople', icon: Users },
  { id: 'media', labelKey: 'dashboard.label.mediaLibrary', blurbKey: 'dashboard.label.photosVideoAndAudio', icon: Image },
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
  const t = useT();
  return (
    <div>
      <p className="text-sm font-medium mb-1">{t('dashboard.description.whatWillYouUseDosyaFor')}</p>
      <p className="text-xs text-muted-foreground mb-3">
        {t('dashboard.description.thisOnlyTailorsTheSuggestionsBelowYouCanChangeDirectionAny')}
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            data-testid={`purpose-${o.id}`}
            onClick={() => onPick(o.id)}
            className="flex flex-col items-start gap-1.5 p-3 rounded-lg border text-start hover:bg-muted/50 hover:border-foreground/20 transition-colors"
          >
            <o.icon className="size-4 text-muted-foreground" />
            <span className="text-xs font-medium">{t(o.labelKey)}</span>
            <span className="text-[11px] text-muted-foreground leading-tight">{t(o.blurbKey)}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        data-testid="purpose-skip"
        onClick={onSkip}
        className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {t('dashboard.action.skipThis')}
      </button>
    </div>
  );
}
