import { describe, it, expect } from 'vitest';
import { STEP_SETS, stepsFor, ALL_DERIVATION_KEYS } from './steps';

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
