import { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/lib/i18n';
import type { Rating } from '@/lib/support-chat/types';
import { cn } from '@/lib/utils';

const MAX_COMMENT = 500;

/**
 * Stars, "was it solved" and an optional note, shown once a conversation ended.
 * A saved rating stays editable (prefilled, with the thanks line) until the
 * 7-day rating window closes; then the card is read-only.
 */
export function RatingCard({ name, rating, closed, onRate }: {
  name: string | null;
  rating: Rating | null;
  closed: boolean;
  onRate: (stars: number, solved: boolean, comment: string) => Promise<void>;
}) {
  const t = useT();
  const [stars, setStars] = useState(rating?.stars ?? 0);
  const [solved, setSolved] = useState<boolean | null>(rating?.solved ?? null);
  const [comment, setComment] = useState(rating?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  // A saved rating (this one just submitted, or one from another device) becomes the new starting point.
  useEffect(() => {
    if (!rating) return;
    setStars(rating.stars);
    setSolved(rating.solved);
    setComment(rating.comment ?? '');
  }, [rating?.stars, rating?.solved, rating?.comment]); // eslint-disable-line react-hooks/exhaustive-deps

  const heading = name ? t('support-chat.heading.howWasYourChatWithName', { name }) : t('support-chat.heading.howWasYourChat');
  const readOnly = closed;
  const shownStars = rating ? rating.stars : stars;
  const unchanged = rating !== null && stars === rating.stars && solved === rating.solved && comment.trim() === (rating.comment ?? '');
  const starLabel = (n: number) => t('support-chat.label.starsOutOfFive', { count: n });

  const move = (to: number) => {
    const next = Math.min(5, Math.max(1, to));
    setStars(next);
    refs.current[next - 1]?.focus();
  };
  const onKey = (e: React.KeyboardEvent, n: number) => {
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    if (e.key === 'ArrowRight') { e.preventDefault(); move(n + (rtl ? -1 : 1)); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(n + (rtl ? 1 : -1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(n + 1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(n - 1); }
  };
  const submit = async () => {
    if (!stars || solved === null || busy || unchanged) return;
    setBusy(true);
    try { await onRate(stars, solved, comment); } finally { setBusy(false); }
  };

  const pill = (active: boolean) => cn(
    'rounded-full border px-3 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
  );

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border bg-card p-3 text-sm">
      <p className="font-medium">{heading}</p>
      {readOnly ? (
        <div className="flex items-center gap-0.5" role="img" aria-label={starLabel(shownStars)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} aria-hidden="true" className={cn('size-5', n <= shownStars ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')} />
          ))}
        </div>
      ) : (
        <div role="radiogroup" aria-label={heading} className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              ref={(el) => { refs.current[n - 1] = el; }}
              type="button"
              role="radio"
              aria-checked={stars === n}
              aria-label={starLabel(n)}
              tabIndex={stars === n || (stars === 0 && n === 1) ? 0 : -1}
              className="rounded p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setStars(n)}
              onKeyDown={(e) => onKey(e, n)}
            >
              <Star aria-hidden="true" className={cn('size-5', n <= stars ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')} />
            </button>
          ))}
        </div>
      )}
      {readOnly ? (
        <>
          {rating && <p className="text-xs text-muted-foreground">{rating.solved ? t('support-chat.label.solved') : t('support-chat.label.notSolved')}</p>}
          {rating?.comment && <p className="whitespace-pre-wrap break-words text-xs" dir="auto">{rating.comment}</p>}
          {rating && <p className="text-xs text-muted-foreground">{t('support-chat.feedback.thanksForYourFeedback')}</p>}
        </>
      ) : (
        <>
          {rating && <p className="text-xs text-muted-foreground">{t('support-chat.feedback.thanksForYourFeedback')}</p>}
          <p className="text-xs text-muted-foreground">{t('support-chat.label.wasYourIssueSolved')}</p>
          <div className="flex gap-2">
            <button type="button" aria-pressed={solved === true} className={pill(solved === true)} onClick={() => setSolved(true)}>{t('common.yes')}</button>
            <button type="button" aria-pressed={solved === false} className={pill(solved === false)} onClick={() => setSolved(false)}>{t('common.no')}</button>
          </div>
          <Textarea
            value={comment}
            maxLength={MAX_COMMENT}
            rows={2}
            placeholder={t('support-chat.placeholder.anythingElseOptional')}
            aria-label={t('support-chat.placeholder.anythingElseOptional')}
            className="min-h-12 resize-none"
            onChange={(e) => setComment(e.target.value)}
          />
          <Button type="button" size="sm" className="self-end" disabled={!stars || solved === null || busy || unchanged} onClick={() => void submit()}>
            {t('support-chat.action.sendRating')}
          </Button>
        </>
      )}
    </div>
  );
}
