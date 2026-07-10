import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number } | null;
  onClose: () => void;
}

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!position) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler); };
  }, [position, onClose]);

  // Keep the menu fully inside the viewport: shift up/left only as far as
  // needed (never past the top/left edge). A full flip (y - height) could push
  // a tall menu above the viewport where it can't be scrolled to.
  useEffect(() => {
    if (!position || !menuRef.current) return;
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const pad = 8;
    const x = Math.max(pad, Math.min(position.x, window.innerWidth - rect.width - pad));
    const y = Math.max(pad, Math.min(position.y, window.innerHeight - rect.height - pad));
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }, [position]);

  if (!position) return null;

  const visibleItems = items.filter((i) => !i.hidden);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9000] bg-popover text-popover-foreground border rounded-xl shadow-xl py-1.5 min-w-45 max-h-[calc(100vh-16px)] overflow-y-auto animate-in fade-in zoom-in-95 duration-100"
      style={{ left: position.x, top: position.y }}
    >
      {visibleItems.map((item, i) =>
        item.separator ? (
          <div key={`sep-${i}`} className="h-px bg-border mx-2 my-1" />
        ) : (
          <button
            key={item.label}
            onClick={() => { item.onClick(); onClose(); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-medium transition-colors ${item.danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-muted/50'}`}
          >
            {item.icon && <span className="shrink-0 [&>svg]:size-3.5">{item.icon}</span>}
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  );
}
