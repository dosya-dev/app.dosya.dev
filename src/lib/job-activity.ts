/**
 * Remembers, per browser, whether a background job (a remote download, a
 * cloud import) was still running the last time this client looked.
 *
 * The two sidebar indicators used to list their jobs on every page load and
 * every workspace switch, for every user, so that the ring could appear for
 * the rare one with something running. Most loads paid two requests to learn
 * "nothing". Now a store records whether anything was active after each
 * refresh, and the indicators only ask on mount when the answer was yes.
 *
 * The trade: a job started on ANOTHER device is not shown here until this
 * client lists jobs for some other reason (opening the page that starts
 * them, which refreshes the store). A job started here is always shown -
 * starting it refreshes the store, which records it as active.
 *
 * localStorage can be absent or throw (private windows, blocked storage);
 * every path here falls back to "nothing was active", which is the same
 * answer a fresh browser gives.
 */
const KEY = 'dosya_active_jobs';

export type JobKind = 'remote' | 'cloud';

type Flags = Partial<Record<JobKind, boolean>>;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function read(store: Storage | null): Flags {
  if (!store) return {};
  try {
    const raw = store.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Flags) : {};
  } catch {
    return {};
  }
}

/** Whether a job of this kind was active the last time this client checked. */
export function hadActiveJobs(kind: JobKind, store: Storage | null = storage()): boolean {
  return read(store)[kind] === true;
}

/** Record the answer from the latest refresh. Writes only on a change. */
export function rememberActiveJobs(kind: JobKind, active: boolean, store: Storage | null = storage()): void {
  if (!store) return;
  try {
    const flags = read(store);
    if ((flags[kind] === true) === active) return;
    flags[kind] = active;
    store.setItem(KEY, JSON.stringify(flags));
  } catch {
    /* storage refused the write; the next refresh answers again */
  }
}
