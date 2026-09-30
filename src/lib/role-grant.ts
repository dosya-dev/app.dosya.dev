/**
 * Which roles the signed-in member may hand to someone else.
 *
 * A browser-side mirror of apps/api/src/lib/role-rank.ts. The server is the
 * authority and refuses on its own; this exists so the role pickers on the
 * team page stop offering roles the request is certain to 403 on, and so the
 * role editor can grey out permissions the caller cannot grant. Presentation
 * only, never enforcement - keep the two files in step by hand, the rules
 * are short enough to read side by side.
 *
 * The rule is one sentence: a role may be granted (invite, invite link,
 * member role change) if and only if it is not role_owner AND every
 * permission it grants is one the caller holds. There is no rank ladder, no
 * manage_roles lift and no built-in exemption any more - those let a caller
 * hand out permissions they did not have themselves.
 */

const OWNER_ROLE_ID = 'role_owner';

/**
 * The requested grants the grantor does not hold, in request order, so a
 * message can name them. A requested `false` is never an escalation, and an
 * absent grantor key reads as `false`.
 */
export function permissionsBeyondGrantor(
  myPerms: Record<string, boolean>,
  targetPerms: Record<string, boolean>,
): string[] {
  const beyond: string[] = [];
  for (const [key, granted] of Object.entries(targetPerms)) {
    if (granted === true && myPerms[key] !== true) beyond.push(key);
  }
  return beyond;
}

/**
 * Whether the caller may invite someone into, or move someone onto, `target`.
 *
 * Owner is never grantable - ownership is transferred, not assigned. Every
 * other role, built-in or custom, must grant nothing the caller lacks. The
 * caller's own role id is irrelevant: only what they hold counts.
 */
export function canGrantRole(
  myPerms: Record<string, boolean>,
  target: { id: string; is_builtin?: boolean; permissions?: Record<string, boolean> },
): boolean {
  if (target.id === OWNER_ROLE_ID) return false;
  return permissionsBeyondGrantor(myPerms, target.permissions ?? {}).length === 0;
}

/** The sentence POST/PUT /api/roles answers with when a grant is over the ceiling. */
const CEILING_PREFIX = "You can't grant permissions you don't hold yourself:";

/**
 * The permission keys named in a ceiling refusal, so the editor can mark the
 * rows the server objected to. Anything that is not that sentence yields [].
 */
export function permissionsNamedInRefusal(message: string): string[] {
  if (!message.startsWith(CEILING_PREFIX)) return [];
  return message.slice(CEILING_PREFIX.length).split(',').map((k) => k.trim()).filter(Boolean);
}
