import { scorePassword } from '@/lib/password-strength';

const BAR_COLORS = [
  'bg-destructive',
  'bg-destructive',
  'bg-amber-500',
  'bg-lime-500',
  'bg-green-500',
];

const TEXT_COLORS = [
  'text-destructive',
  'text-destructive',
  'text-amber-600 dark:text-amber-500',
  'text-lime-600 dark:text-lime-500',
  'text-green-600 dark:text-green-500',
];

/**
 * Four-segment strength meter shown under a new-password field. Renders
 * nothing until the user types, so an untouched form is not pre-scolded.
 */
export function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const { score, label, warning } = scorePassword(password);

  return (
    <div className="mt-1.5" aria-live="polite">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((seg) => (
          <div
            key={seg}
            className={`h-1 flex-1 rounded-full transition-colors ${
              score >= seg ? BAR_COLORS[score] : 'bg-muted'
            }`}
          />
        ))}
      </div>
      <p className={`text-xs mt-1 ${TEXT_COLORS[score]}`}>
        {label}
        {warning && <span className="text-muted-foreground"> · {warning}</span>}
      </p>
    </div>
  );
}
