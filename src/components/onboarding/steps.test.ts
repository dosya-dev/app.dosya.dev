import { describe, it, expect } from 'vitest';
import { STEP_SETS, stepsFor, shouldShowFirstRun, ALL_DERIVATION_KEYS, type Purpose } from './steps';

describe('stepsFor', () => {
  it('returns the dev set in order for the dev purpose', () => {
    expect(stepsFor('dev').map((s) => s.key)).toEqual(['upload', 'api_key', 'client_used', 'share']);
  });

  it('returns the team set in order for the team purpose', () => {
    expect(stepsFor('team').map((s) => s.key)).toEqual(['upload', 'invite', 'share', 'file_request']);
  });

  it('falls back to the generic set when the purpose is unanswered', () => {
    expect(stepsFor(null).map((s) => s.key)).toEqual(['upload', 'share', 'client_used', 'invite']);
  });

  // The store copies `purpose` in from the API unvalidated. A fifth purpose
  // deployed API-side before the web build, or a bad value written straight
  // to D1, must fall back to the generic set rather than throwing - onboarding
  // must never be load-bearing for the whole dashboard.
  it('falls back to the generic set for an unknown purpose value rather than throwing', () => {
    expect(() => stepsFor('wizard' as Purpose)).not.toThrow();
    expect(stepsFor('wizard' as Purpose).map((s) => s.key)).toEqual(stepsFor(null).map((s) => s.key));
  });
});

describe('shouldShowFirstRun', () => {
  it('is true when the workspace is empty, has no trash, and onboarding is not dismissed', () => {
    expect(shouldShowFirstRun({ total_files: 0, trash_bytes: 0 }, false)).toBe(true);
  });

  it('is false when the workspace is empty but onboarding was dismissed', () => {
    expect(shouldShowFirstRun({ total_files: 0, trash_bytes: 0 }, true)).toBe(false);
  });

  it('is false when the workspace has live files', () => {
    expect(shouldShowFirstRun({ total_files: 5, trash_bytes: 0 }, false)).toBe(false);
  });

  // The bug this predicate exists to fix: a long-time account that selects
  // all and deletes has zero live files but still occupies its quota.
  it('is false when there are no live files but trash still holds bytes', () => {
    expect(shouldShowFirstRun({ total_files: 0, trash_bytes: 1024 }, false)).toBe(false);
  });
});

describe('STEP_SETS', () => {
  it('gives every set exactly four steps', () => {
    for (const [name, steps] of Object.entries(STEP_SETS)) {
      expect(steps.length, `${name} should have four steps`).toBe(4);
    }
  });

  it('starts every set with the upload step', () => {
    for (const [name, steps] of Object.entries(STEP_SETS)) {
      expect(steps[0].key, `${name} should start with upload`).toBe('upload');
    }
  });

  // The collision guard. WebDAV, S3, rclone, the CLI and the REST API all
  // authenticate against the same api_keys table, so a set containing both
  // "create an API key" and "mount over S3" would tick two boxes from one
  // event. This test is why api_key (row exists) and client_used
  // (last_used_at is set) are separate derivations, and it stops the class
  // of bug from being reintroduced when the copy is edited later.
  it('never repeats a derivation key within a set', () => {
    for (const [name, steps] of Object.entries(STEP_SETS)) {
      const keys = steps.map((s) => s.key);
      expect(new Set(keys).size, `${name} has two steps sharing a derivation`).toBe(keys.length);
    }
  });

  it('only uses derivation keys the API actually returns', () => {
    for (const [name, steps] of Object.entries(STEP_SETS)) {
      for (const step of steps) {
        expect(ALL_DERIVATION_KEYS, `${name}.${step.key} is not a known derivation`).toContain(step.key);
      }
    }
  });

  it('points every step at an in-app route or an absolute URL', () => {
    for (const steps of Object.values(STEP_SETS)) {
      for (const step of steps) {
        expect(step.href.startsWith('/') || step.href.startsWith('https://')).toBe(true);
      }
    }
  });
});
