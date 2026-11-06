/**
 * Keep the app rendering under browser page translation.
 *
 * Chrome's (and Edge's) translate does not edit text in place: it detaches
 * each text node and puts a <font> with the translated string where it was.
 * React still holds the detached node, so the next time it removes it, or
 * inserts a sibling before it, the DOM throws NotFoundError and the router's
 * error page replaces the screen. Sentry 149714040 hit /profile on 09-28
 * (fixed for that page only) and /welcome on 10-20; any page with a
 * conditional text child can do it.
 *
 * Fixing every component does not scale, so the two DOM calls React makes are
 * made tolerant instead (the workaround from facebook/react#11538):
 *  - removeChild of a node that is not a child does nothing, because the
 *    translator already took it out;
 *  - insertBefore with a reference node that is not a child appends, which is
 *    where the browser would have put it had the reference been null.
 * Both only change the outcome of a call that would otherwise throw, so a
 * correct call behaves exactly as before. Installed once, before React mounts.
 */
const INSTALLED = Symbol.for('dosya.translateGuard');

export function installTranslateGuard(): void {
  if (typeof Node === 'undefined') return;
  const proto = Node.prototype as Node & { [INSTALLED]?: true };
  if (proto[INSTALLED]) return;
  proto[INSTALLED] = true;

  const removeChild = proto.removeChild;
  proto.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) return child;
    return removeChild.call(this, child) as T;
  };

  const insertBefore = proto.insertBefore;
  proto.insertBefore = function <T extends Node>(this: Node, node: T, reference: Node | null): T {
    if (reference && reference.parentNode !== this) return insertBefore.call(this, node, null) as T;
    return insertBefore.call(this, node, reference) as T;
  };
}
