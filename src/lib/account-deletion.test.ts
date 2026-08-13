import { describe, it, expect } from 'vitest';
import {
  RESEND_COOLDOWN_SECONDS, CODE_LENGTH,
  normaliseCode, isCompleteCode, cooldownRemaining,
  describeBlocker, formatScheduledDate, daysRemaining, classifyDeleteError,
} from './account-deletion';

/** Minimal stand-in for the api client's ApiError, which carries `status`. */
function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

describe('server constants are mirrored, or the UI lies', () => {
  it('matches the API cooldown and code width', () => {
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
    expect(CODE_LENGTH).toBe(6);
  });
});

describe('normaliseCode', () => {
  it('keeps digits only, so a pasted code with spaces or dashes still works', () => {
    expect(normaliseCode('12 34-56')).toBe('123456');
    expect(normaliseCode('abc12')).toBe('12');
  });

  it('caps at the code length', () => {
    expect(normaliseCode('1234567890')).toBe('123456');
  });
});

describe('isCompleteCode', () => {
  it('is true only for exactly six digits', () => {
    expect(isCompleteCode('123456')).toBe(true);
    expect(isCompleteCode('12345')).toBe(false);
    expect(isCompleteCode('1234567')).toBe(false);
    expect(isCompleteCode('12345a')).toBe(false);
    expect(isCompleteCode('')).toBe(false);
  });
});

describe('cooldownRemaining', () => {
  it('is zero before a code has been sent, so the control starts enabled', () => {
    expect(cooldownRemaining(null, 1_000_000)).toBe(0);
  });

  it('counts down from 60 and floors at zero', () => {
    const t = 1_000_000;
    expect(cooldownRemaining(t, t)).toBe(60);
    expect(cooldownRemaining(t, t + 30_000)).toBe(30);
    expect(cooldownRemaining(t, t + 60_000)).toBe(0);
    expect(cooldownRemaining(t, t + 999_000)).toBe(0);
  });
});

describe('describeBlocker', () => {
  it('names the workspace, the count and the recovery', () => {
    const m = describeBlocker({
      kind: 'workspace_has_members', workspace_id: 'w', workspace_name: 'Acme', member_count: 3,
    });
    expect(m).toContain('Acme');
    expect(m).toContain('3 other members');
    expect(m).toMatch(/transfer/i);
  });

  it('uses the singular for one member', () => {
    const m = describeBlocker({
      kind: 'workspace_has_members', workspace_id: 'w', workspace_name: 'Solo', member_count: 1,
    });
    expect(m).toContain('1 other member');
    expect(m).not.toContain('members');
  });
});

describe('daysRemaining', () => {
  it('floors rather than rounds, so it never overstates the time left', () => {
    const now = 1_000_000;
    expect(daysRemaining(now + 86400 + 82800, now)).toBe(1);
  });

  it('is zero once the date has passed', () => {
    const now = 1_000_000;
    expect(daysRemaining(now - 10, now)).toBe(0);
  });

  it('counts a full window', () => {
    const now = 1_000_000;
    expect(daysRemaining(now + 30 * 86400, now)).toBe(30);
  });
});

describe('formatScheduledDate', () => {
  it('renders a human date rather than a timestamp', () => {
    const out = formatScheduledDate(Math.floor(Date.UTC(2026, 8, 12, 12) / 1000));
    expect(out).toMatch(/2026/);
    expect(out).not.toMatch(/^\d+$/);
  });
});

describe('classifyDeleteError', () => {
  it('separates the two 429s, which need opposite advice', () => {
    expect(classifyDeleteError(err('Too many incorrect attempts. Request a new code.', 429)).kind)
      .toBe('code_burned');
    expect(classifyDeleteError(err('Too many attempts. Try again later.', 429)).kind)
      .toBe('rate_limited');
  });

  it('passes a blocker message through verbatim, since the server names the workspaces', () => {
    const msg = 'Some workspaces you own still have other members. Transfer or remove them first.';
    const f = classifyDeleteError(err(msg, 400));
    expect(f.kind).toBe('blocked');
    expect(f.message).toBe(msg);
  });

  it('treats a plain 400 as a wrong code and names the recovery', () => {
    const f = classifyDeleteError(err('That code is not correct.', 400));
    expect(f.kind).toBe('wrong_code');
    expect(f.message).toMatch(/check/i);
  });

  it('never surfaces an empty message for any input', () => {
    for (const e of [null, undefined, {}, 'oops', err('', 500)]) {
      expect(classifyDeleteError(e).message.trim().length).toBeGreaterThan(0);
    }
  });
});
