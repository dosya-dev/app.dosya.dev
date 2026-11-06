/**
 * Drag-to-move on the files page: the pure rules behind it.
 *
 * A drag started on a file or folder carries a custom data type so every drop
 * handler on the page can tell it apart from files dragged in from the OS. The
 * upload drop zone ignores drags carrying it, and folder targets ignore drags
 * that lack it, so the two never trigger each other.
 *
 * The page's own state (which items are dragged, where they currently live)
 * decides whether a target accepts the drop: `dragover` cannot read the
 * payload, only its type, so validity is answered from the drag the page
 * started rather than from the data.
 */

/** The dataTransfer type a files-page move drag carries. */
export const MOVE_DRAG_TYPE = 'application/x-dosya-move';

export interface MoveItems {
  fileIds: string[];
  folderIds: string[];
}

export interface MovePayload extends MoveItems {
  /** The workspace the drag started in; a drop from another workspace's tab is ignored. */
  workspaceId: string;
}

export interface DragItem {
  id: string;
  kind: 'file' | 'folder';
}

/**
 * What a drag starting on `item` carries: the whole selection when the item is
 * part of it, otherwise just the item. Dragging an unselected row never sweeps
 * the selection along - the same rule desktop file managers follow.
 */
export function itemsForDrag(item: DragItem, selectedFiles: ReadonlySet<string>, selectedFolders: ReadonlySet<string>): MoveItems {
  const inSelection = item.kind === 'file' ? selectedFiles.has(item.id) : selectedFolders.has(item.id);
  if (inSelection) return { fileIds: [...selectedFiles], folderIds: [...selectedFolders] };
  return item.kind === 'file' ? { fileIds: [item.id], folderIds: [] } : { fileIds: [], folderIds: [item.id] };
}

/** How many items a drag carries (what the drag image and the confirm count). */
export function moveCount(items: MoveItems): number {
  return items.fileIds.length + items.folderIds.length;
}

export function encodeMovePayload(payload: MovePayload): string {
  return JSON.stringify({ v: 1, ws: payload.workspaceId, files: payload.fileIds, folders: payload.folderIds });
}

const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);

/** The payload from `encodeMovePayload`, or null for anything else (malformed, empty, foreign). */
export function decodeMovePayload(raw: string | null | undefined): MovePayload | null {
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (o.v !== 1 || typeof o.ws !== 'string' || !o.ws || !isIdList(o.files) || !isIdList(o.folders)) return null;
  if (o.files.length + o.folders.length === 0) return null;
  return { workspaceId: o.ws, fileIds: o.files, folderIds: o.folders };
}

/** Whether a drag event is a files-page move (as opposed to OS files or text). */
export function isMoveDrag(dt: Pick<DataTransfer, 'types'> | null | undefined): boolean {
  if (!dt || !dt.types) return false;
  return Array.from(dt.types).includes(MOVE_DRAG_TYPE);
}

/**
 * Whether `targetFolderId` (null = the workspace root) accepts the items.
 *
 * `sourceFolderId` is the folder the items are listed in: null for the root,
 * undefined when unknown (a group view spans folders), in which case only the
 * folder-onto-itself rule applies and the server judges the rest. A folder
 * dropped into one of its own descendants is not caught here - the listing
 * does not know the tree - and the server refuses it with its own message.
 */
export function canDropOn(items: MoveItems, targetFolderId: string | null, sourceFolderId: string | null | undefined): boolean {
  if (moveCount(items) === 0) return false;
  if (targetFolderId !== null && items.folderIds.includes(targetFolderId)) return false;
  if (sourceFolderId !== undefined && targetFolderId === sourceFolderId) return false;
  return true;
}

/**
 * Whether the current view lets items be dragged at all. The trash, the
 * hidden view and the library views (Documents, Photos, Videos) are not
 * folder listings, so a drag there would have no meaningful "from".
 */
export function canDragInView(view: { isDeleted: boolean; isHidden: boolean; isLibrary: boolean }): boolean {
  return !view.isDeleted && !view.isHidden && !view.isLibrary;
}

/** The most frequent string (first seen wins a tie), or null for none. Picks the reason a move toast names. */
export function mostCommon(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (best === null || n > (counts.get(best) ?? 0)) best = v;
  }
  return best;
}
