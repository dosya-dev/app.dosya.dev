import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDir } from '@/lib/i18n';

interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
  separator?: boolean;
  /** A non-interactive group label ("New") above the items that follow it. */
  heading?: boolean;
  disabled?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number } | null;
  onClose: () => void;
}

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const rtl = useDir() === 'rtl';

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
  // a tall menu above the viewport where it can't be scrolled to. In
  // right-to-left the menu opens with its right edge at the cursor instead.
  useEffect(() => {
    if (!position || !menuRef.current) return;
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const pad = 8;
    const y = Math.max(pad, Math.min(position.y, window.innerHeight - rect.height - pad));
    if (rtl) {
      // rtl-ok: pointer coordinates, the menu opens where the cursor is
      menu.style.right = `${Math.max(pad, Math.min(window.innerWidth - position.x, window.innerWidth - rect.width - pad))}px`;
    } else {
      // rtl-ok: pointer coordinates, the menu opens where the cursor is
      menu.style.left = `${Math.max(pad, Math.min(position.x, window.innerWidth - rect.width - pad))}px`;
    }
    menu.style.top = `${y}px`;
  }, [position, rtl]);

  if (!position) return null;

  const visibleItems = items.filter((i) => !i.hidden);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9000] bg-popover text-popover-foreground border rounded-xl shadow-xl py-1.5 min-w-45 max-h-[calc(100vh-16px)] overflow-y-auto animate-in fade-in zoom-in-95 duration-100"
      // rtl-ok: pointer coordinates, the menu opens where the cursor is
      style={rtl ? { right: window.innerWidth - position.x, top: position.y } : { left: position.x, top: position.y }}
    >
      {visibleItems.map((item, i) =>
        item.separator ? (
          <div key={`sep-${i}`} className="h-px bg-border mx-2 my-1" />
        ) : item.heading ? (
          <div key={`heading-${i}`} role="presentation" className="px-3 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground">{item.label}</div>
        ) : (
          <button
            key={item.label}
            disabled={item.disabled}
            onClick={() => { if (item.disabled) return; item.onClick(); onClose(); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-start text-xs font-medium transition-colors ${item.disabled ? 'opacity-50 pointer-events-none' : item.danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-muted/50'}`}
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
