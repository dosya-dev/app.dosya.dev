import { describe, it, expect } from 'vitest';
import { TOUR_STEPS } from './tour-steps';

describe('TOUR_STEPS', () => {
  it('has five pages in the intended order', () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      'welcome', 'sharing', 'security', 'integrations', 'ready',
    ]);
  });

  it('gives every page a heading and at least three points', () => {
    for (const step of TOUR_STEPS) {
      expect(step.heading.length, `${step.id} needs a heading`).toBeGreaterThan(0);
      expect(step.points.length, `${step.id} needs points`).toBeGreaterThanOrEqual(3);
    }
  });

  it('has no duplicate ids', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The repo convention, and easy to reintroduce when editing prose.
  it('uses no em dashes in any copy', () => {
    for (const step of TOUR_STEPS) {
      const text = [step.heading, ...step.points.flatMap((p) => [p.title, p.body])].join(' ');
      expect(text.includes('—'), `${step.id} contains an em dash`).toBe(false);
      expect(text.includes('–'), `${step.id} contains an en dash`).toBe(false);
    }
  });

  // The vault's zero-knowledge claim is unresolved. Copy here must not assert it.
  it('makes no zero-knowledge claim on the security page', () => {
    const security = TOUR_STEPS.find((s) => s.id === 'security')!;
    const text = [security.heading, ...security.points.flatMap((p) => [p.title, p.body])]
      .join(' ')
      .toLowerCase();
    expect(text).not.toContain('zero-knowledge');
    expect(text).not.toContain('zero knowledge');
    expect(text).not.toContain('cannot read');
  });
});
