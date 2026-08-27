import { describe, it, expect, vi } from 'vitest';
import { logConsoleGreeting } from './console-greeting';

describe('logConsoleGreeting', () => {
  it('logs the bug bounty link', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logConsoleGreeting();
    const output = spy.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(output).toContain('https://dosya.dev/bug-bounty');
    spy.mockRestore();
  });

  it('pairs every %c line with a style argument', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logConsoleGreeting();
    for (const call of spy.mock.calls) {
      if (typeof call[0] === 'string' && call[0].startsWith('%c')) {
        expect(call).toHaveLength(2);
        expect(typeof call[1]).toBe('string');
      }
    }
    spy.mockRestore();
  });
});
