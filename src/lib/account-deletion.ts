/**
 * Pure logic behind the account-deletion flow.
 *
 * A local copy rather than an import from @dosya-dev/shared: apps/web is
 * deployed from a mirror containing only apps/web/, so any ../../packages/*
 * reference escapes that repo and fails the Cloudflare Pages build (see the note
 * in vite.config.ts). Vendoring is the repo's answer to that and is heavier than
 * this module warrants. Keep in sync with apps/mobile/src/account/deletion.ts.
 */

/** Mirrors COOLDOWN_SECONDS in apps/api/src/pages/api/me/delete-request.ts. */
export const RESEND_COOLDOWN_SECONDS = 60;
export const CODE_LENGTH = 6;

const DIGITS_ONLY = /\D/g;
const COMPLETE_CODE = new RegExp(`^\\d{${CODE_LENGTH}}$`);

export interface DeletionBlocker {
  kind: 'workspace_has_members';
  workspace_id: string;
  workspace_name: string;
  member_count: number;
}

export interface DeletePreview {
  workspaces: { id: string; name: string }[];
  file_count: number;
  total_bytes: number;
  blockers: DeletionBlocker[];
  window_days: number;
  deletion_scheduled_for: number | null;
}

/** Digits only, capped at CODE_LENGTH, so pasting "12 34-56" from an email works. */
export function normaliseCode(raw: string): string {
  return raw.replace(DIGITS_ONLY, '').slice(0, CODE_LENGTH);
}

export function isCompleteCode(code: string): boolean {
  return COMPLETE_CODE.test(code);
}

/** Whole seconds left before Resend will actually work. `sentAt`/`now` are epoch ms. */
export function cooldownRemaining(sentAt: number | null, now: number): number {
  if (sentAt == null) return 0;
  return Math.max(0, RESEND_COOLDOWN_SECONDS - Math.floor((now - sentAt) / 1000));
}

/**
 * Human sentence for a blocker.
 *
 * Names the workspace, the count and the recovery, because "you have blockers"
 * tells the user nothing they can act on.
 */
export function describeBlocker(b: DeletionBlocker): string {
  const n = b.member_count;
  return `${b.workspace_name} still has ${n} other ${n === 1 ? 'member' : 'members'}. Transfer it or remove them first.`;
}

export function formatScheduledDate(scheduledFor: number): string {
  return new Date(scheduledFor * 1000).toLocaleDateString(undefined, {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

/**
 * Whole days left, floored and never negative. Floored rather than rounded:
 * saying "1 day" when six hours remain is the wrong direction to be wrong in.
 */
export function daysRemaining(scheduledFor: number, nowSeconds: number): number {
  return Math.max(0, Math.floor((scheduledFor - nowSeconds) / 86400));
}

export type DeleteFailureKind = 'wrong_code' | 'rate_limited' | 'code_burned' | 'blocked' | 'unknown';

export interface DeleteFailure {
  kind: DeleteFailureKind;
  message: string;
}

function statusOf(err: unknown): number {
  if (typeof err === 'object' && err !== null) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === 'number') return s;
  }
  return 0;
}

function messageOf(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return '';
}

/**
 * Map a failure onto advice the user can act on.
 *
 * The two 429s need opposite advice: an hourly cap means wait, but the per-code
 * cap BURNS the code, so retrying the same digits can never succeed and telling
 * the user to try again would be actively wrong.
 */
export function classifyDeleteError(err: unknown): DeleteFailure {
  const status = statusOf(err);
  const raw = messageOf(err);

  if (status === 429) {
    if (/request a new code/i.test(raw)) {
      return { kind: 'code_burned', message: 'Too many tries on that code. Request a new one.' };
    }
    return { kind: 'rate_limited', message: 'Too many attempts. Wait a few minutes, then try again.' };
  }

  if (status === 400 && /other members|transfer/i.test(raw)) {
    return { kind: 'blocked', message: raw };
  }

  if (status === 400) {
    return {
      kind: 'wrong_code',
      message: 'That code is not right, or it has expired. Check the 6 digits, or request a new one.',
    };
  }

  return { kind: 'unknown', message: raw.trim() || 'Could not delete your account. Please try again.' };
}
