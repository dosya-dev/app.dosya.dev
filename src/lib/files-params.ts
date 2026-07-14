/**
 * The URL query string is the single source of truth for what the files page is
 * showing: `folder` (where you are), `filter` (which file types the sidebar has
 * selected), `group` (a flat, folder-spanning group view) and `page`.
 *
 * Each navigation is a transition between those states, and the transitions are
 * defined here so the rules about which params survive live in one place rather
 * than being re-derived at every call site. Building params from scratch is what
 * silently dropped the sidebar filter whenever you opened a folder.
 */

/** Params that are scoped to one view and must never be carried across a navigation. */
function carryOver(current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  // Pagination is per-view: item 3 of a folder has nothing to do with item 3 of the next.
  next.delete('page');
  // `file` is a one-shot deep-link from the upload dock (scroll to + highlight).
  next.delete('file');
  return next;
}

/**
 * Open a folder (or the root, with `null`), keeping the sidebar's type filter so
 * a filtered view stays filtered while you browse nested folders. Leaves any
 * group view, since a group is a flat list that spans folders.
 */
export function folderNavParams(current: URLSearchParams, folderId: string | null): URLSearchParams {
  const next = carryOver(current);
  next.delete('group');
  if (folderId) next.set('folder', folderId);
  else next.delete('folder');
  return next;
}

/**
 * Pick a sidebar type filter (`''` = All), keeping the current folder so the
 * filter applies where you are standing rather than throwing you back to root.
 */
export function filterNavParams(current: URLSearchParams, filter: string): URLSearchParams {
  const next = carryOver(current);
  next.delete('group');
  if (filter) next.set('filter', filter);
  else next.delete('filter');
  return next;
}

/** Open a group: a flat view of everything in the group, so folder and filter don't apply. */
export function groupNavParams(current: URLSearchParams, groupId: string): URLSearchParams {
  const next = carryOver(current);
  next.delete('folder');
  next.delete('filter');
  next.set('group', groupId);
  return next;
}
