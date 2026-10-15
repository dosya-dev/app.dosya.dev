const KEY = 'dosya.postAuthPath';

/** A path on this origin: one leading slash, no scheme, no protocol-relative form. */
function isSafePath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}

export function rememberPostAuthPath(path: string): void {
  try {
    if (isSafePath(path)) sessionStorage.setItem(KEY, path);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Restricted contexts can disable sessionStorage; the visitor lands on / instead.
  }
}

export function consumePostAuthPath(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return path && isSafePath(path) ? path : null;
  } catch {
    return null;
  }
}
