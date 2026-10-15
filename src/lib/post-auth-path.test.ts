import { describe, it, expect, beforeEach } from 'vitest';
import { rememberPostAuthPath, consumePostAuthPath } from './post-auth-path';

/**
 * The consent page (/connect/extension) sends a signed-out visitor through
 * the normal login and must get them back, query string and all. Stored in
 * sessionStorage: one tab, one sign-in.
 */
describe('post-auth path', () => {
  beforeEach(() => sessionStorage.clear());

  it('remembers a same-origin path with its query and hands it back once', () => {
    rememberPostAuthPath('/connect/extension?client=chrome&state=abc');
    expect(consumePostAuthPath()).toBe('/connect/extension?client=chrome&state=abc');
    expect(consumePostAuthPath()).toBeNull();
  });

  it('refuses anything that is not a single-slash path', () => {
    for (const bad of ['https://evil.example/x', '//evil.example', 'connect', '', '/\\evil.example']) {
      rememberPostAuthPath(bad);
      expect(consumePostAuthPath(), bad).toBeNull();
    }
  });
});
