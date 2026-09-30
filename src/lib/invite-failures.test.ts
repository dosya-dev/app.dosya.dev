import { describe, it, expect } from 'vitest';
import { summarizeInviteFailures } from './invite-failures';

// Bulk email invites report one line per address. When a role is not
// grantable every address fails with the identical 403 sentence, and the
// dialog repeated it N times. One sentence, then the addresses.
describe('summarizeInviteFailures', () => {
  it('collapses identical failures into one message with the address list', () => {
    const msg = "You can't grant that role.";
    expect(summarizeInviteFailures([
      { addr: 'a@x.com', message: msg },
      { addr: 'b@x.com', message: msg },
    ])).toBe("You can't grant that role. (a@x.com, b@x.com)");
  });

  it('keeps per-address lines when the reasons differ', () => {
    expect(summarizeInviteFailures([
      { addr: 'a@x.com', message: 'Already a member' },
      { addr: 'b@x.com', message: 'Invalid email' },
    ])).toBe('a@x.com: Already a member · b@x.com: Invalid email');
  });

  it('names the address even for a single failure', () => {
    expect(summarizeInviteFailures([{ addr: 'a@x.com', message: 'Already a member' }]))
      .toBe('a@x.com: Already a member');
  });
});
