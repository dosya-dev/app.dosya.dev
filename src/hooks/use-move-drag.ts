import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import {
  MOVE_DRAG_TYPE, itemsForDrag, moveCount, encodeMovePayload, decodeMovePayload, isMoveDrag, canDropOn,
  type DragItem, type MoveItems,
} from '@/lib/drag-move';

/** Where a drop lands: a folder, or the workspace root (`id: null`). */
export interface MoveDropTarget {
  id: string | null;
  name: string;
}

export interface UseMoveDragOptions {
  /** False in views where nothing can be dragged (trash, hidden, library) and with no workspace. */
  enabled: boolean;
  workspaceId: string;
  /** The folder the listed items live in; undefined when unknown (group view). See canDropOn. */
  sourceFolderId: string | null | undefined;
  selectedFiles: ReadonlySet<string>;
  selectedFolders: ReadonlySet<string>;
  /** Label for the drag image when several items are dragged ("3 items"). */
  countLabel: (count: number) => string;
  onDrop: (items: MoveItems, target: MoveDropTarget) => void;
}

const ROOT_KEY = '\u0000root';
const keyOf = (id: string | null) => id ?? ROOT_KEY;

/**
 * A small pill for the drag image when more than one item moves. It has to be
 * in the document and rendered when setDragImage reads it, then can go.
 */
function showCountImage(dt: DataTransfer, label: string) {
  if (typeof dt.setDragImage !== 'function') return;
  const el = document.createElement('div');
  el.textContent = label;
  el.className = 'fixed -top-96 inset-s-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-md whitespace-nowrap pointer-events-none';
  document.body.appendChild(el);
  dt.setDragImage(el, -12, -12);
  window.setTimeout(() => el.remove(), 0);
}

/**
 * Mouse drag-to-move for the files page. Sources get `dragSourceProps`, targets
 * `dropTargetProps`; `isOver` says which target to highlight. The page decides
 * what happens on drop (a confirm dialog), nothing moves here.
 */
export function useMoveDrag(opts: UseMoveDragOptions) {
  const { enabled, workspaceId, selectedFiles, selectedFolders, countLabel } = opts;
  // The drag this page started. dragover can only read the data's TYPE, so
  // targets judge validity from this rather than from the payload.
  const activeRef = useRef<MoveItems | null>(null);
  // Per-target enter/leave balance: moving between a target's child elements
  // fires dragleave on one and dragenter on the next, and the highlight must
  // not flicker through that.
  const countersRef = useRef(new Map<string, number>());
  const [overKey, setOverKey] = useState<string | null>(null);

  // The latest options for handlers created during render without re-binding.
  // Handlers only run after a commit, so an effect keeps this current in time.
  const latest = useRef(opts);
  useEffect(() => { latest.current = opts; });

  const reset = useCallback(() => {
    activeRef.current = null;
    countersRef.current.clear();
    setOverKey(null);
  }, []);

  // dragend normally reaches the source's handler, but not when the source
  // row re-rendered away mid-drag. Capture at the document as a backstop; the
  // drop backstop is deferred so the target's own handler reads the drag first.
  useEffect(() => {
    const onEnd = () => reset();
    const onDocDrop = () => { window.setTimeout(reset, 0); };
    document.addEventListener('dragend', onEnd, true);
    document.addEventListener('drop', onDocDrop, true);
    return () => {
      document.removeEventListener('dragend', onEnd, true);
      document.removeEventListener('drop', onDocDrop, true);
    };
  }, [reset]);

  const accepts = (target: MoveDropTarget): boolean => {
    // A view change (trash, library) mid-drag turns every target off.
    if (!latest.current.enabled) return false;
    const items = activeRef.current;
    return !!items && canDropOn(items, target.id, latest.current.sourceFolderId);
  };

  const dragSourceProps = (item: DragItem) => {
    if (!enabled) return {};
    return {
      draggable: true,
      onDragStart: (e: DragEvent) => {
        const items = itemsForDrag(item, selectedFiles, selectedFolders);
        const dt = e.dataTransfer;
        // Drop whatever the browser pre-filled (an <img> inside the card puts
        // its URL here), so nothing but the move type travels with the drag.
        dt.clearData();
        dt.setData(MOVE_DRAG_TYPE, encodeMovePayload({ workspaceId, ...items }));
        dt.effectAllowed = 'move';
        const count = moveCount(items);
        if (count > 1) showCountImage(dt, countLabel(count));
        activeRef.current = items;
        countersRef.current.clear();
      },
      onDragEnd: () => reset(),
    };
  };

  const dropTargetProps = (target: MoveDropTarget) => {
    const key = keyOf(target.id);
    return {
      onDragEnter: (e: DragEvent) => {
        if (!isMoveDrag(e.dataTransfer) || !accepts(target)) return;
        e.preventDefault();
        const counters = countersRef.current;
        counters.set(key, (counters.get(key) ?? 0) + 1);
        setOverKey(key);
      },
      onDragOver: (e: DragEvent) => {
        // OS files and invalid targets fall through to the page's handler,
        // which uploads the former and shows "no drop" for the latter.
        if (!isMoveDrag(e.dataTransfer) || !accepts(target)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setOverKey((cur) => (cur === key ? cur : key));
      },
      onDragLeave: (e: DragEvent) => {
        if (!isMoveDrag(e.dataTransfer)) return;
        const counters = countersRef.current;
        const n = (counters.get(key) ?? 0) - 1;
        if (n > 0) { counters.set(key, n); return; }
        counters.delete(key);
        setOverKey((cur) => (cur === key ? null : cur));
      },
      onDrop: (e: DragEvent) => {
        if (!isMoveDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        const items = activeRef.current;
        const decoded = decodeMovePayload(e.dataTransfer.getData(MOVE_DRAG_TYPE));
        const ok = !!items && canDropOn(items, target.id, latest.current.sourceFolderId)
          // Only a drag this page started, in this workspace.
          && (!decoded || decoded.workspaceId === latest.current.workspaceId);
        reset();
        if (ok && items) latest.current.onDrop(items, target);
      },
    };
  };

  const isOver = (id: string | null) => enabled && overKey === keyOf(id);

  return { dragSourceProps, dropTargetProps, isOver };
}
