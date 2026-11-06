import { API_BASE } from '@/api/client';
import type { Persona } from '@/lib/support-chat/types';
import { cn } from '@/lib/utils';

/** Presence dot: green when staff are online, grey otherwise. */
export function PresenceDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('inline-block size-2 rounded-full', online ? 'bg-green-500' : 'bg-muted-foreground/50', className)} />
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = Array.from(parts[0])[0] ?? '';
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** A support person's picture, or their initials. Decorative: the name always sits beside it. */
export function PersonaAvatar({ persona, size = 28, className }: { persona: Pick<Persona, 'name' | 'avatar_url'>; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)) };
  if (persona.avatar_url) {
    return (
      <img
        src={`${API_BASE}${persona.avatar_url}`}
        alt=""
        aria-hidden="true"
        crossOrigin="use-credentials"
        style={style}
        className={cn('shrink-0 rounded-full object-cover', className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn('flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground', className)}
    >
      {initials(persona.name)}
    </span>
  );
}
