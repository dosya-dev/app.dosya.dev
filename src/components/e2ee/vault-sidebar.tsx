import { useState } from 'react';
import type { KnownWorkspace } from '@/stores/e2ee';
import { ChevronLeft, ChevronRight, FolderLock, Plus, Users } from 'lucide-react';

/**
 * The Vault's left Space menu - the vertical counterpart to the horizontal
 * Space chips EncryptedBrowser used to render inline. Deliberately mirrors
 * FilesSidebar's shell (w-48 / w-12 collapsed, border-r, localStorage-persisted
 * collapse, md-and-up only) so /vault and /files read as the same product.
 *
 * Purely presentational: every Space list, the active id, and both actions are
 * props. EncryptedBrowser stays the single owner of that state because it also
 * owns the breadcrumb `folderPath`, which has to reset in the same click that
 * switches Spaces - splitting the two would let a stale breadcrumb survive a
 * switch.
 *
 * Below `md` this renders nothing; EncryptedBrowser falls back to the chip row
 * there, so Spaces never become unreachable on a phone.
 */
export function VaultSidebar({
  mySpaces,
  sharedSpaces,
  activeId,
  onSelect,
  onNewSpace,
}: {
  mySpaces: KnownWorkspace[];
  sharedSpaces: KnownWorkspace[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewSpace: () => void;
}) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('dosya_vault_sidebar_collapsed') === '1',
  );

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('dosya_vault_sidebar_collapsed', next ? '1' : '0');
      return next;
    });
  };

  return (
    <div
      className={`${collapsed ? 'w-12' : 'w-48'} shrink-0 border-r md:flex flex-col overflow-hidden transition-all duration-200 hidden`}
    >
      {/* Collapse toggle */}
      <div className="flex items-center justify-end px-2 py-2 shrink-0">
        <button
          onClick={toggleCollapse}
          className="size-6 rounded flex items-center justify-center hover:bg-muted"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed
            ? <ChevronRight className="size-3.5 text-muted-foreground" />
            : <ChevronLeft className="size-3.5 text-muted-foreground" />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-3">
        {/* My Spaces */}
        <div className={collapsed ? 'px-1.5' : 'px-3'}>
          {collapsed ? (
            <button
              onClick={onNewSpace}
              className="w-full flex items-center justify-center py-2 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              title="New Space"
            >
              <Plus className="size-4" />
            </button>
          ) : (
            <div className="flex items-center gap-1.5 mb-1.5">
              <FolderLock className="size-3 text-muted-foreground" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex-1">
                My Spaces
              </span>
              <button
                onClick={onNewSpace}
                className="size-4 rounded flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground"
                title="New Space"
              >
                <Plus className="size-3" />
              </button>
            </div>
          )}

          {mySpaces.length === 0 ? (
            !collapsed && <p className="text-[11px] text-muted-foreground/60 pl-4.5">No Spaces yet</p>
          ) : (
            <div className="space-y-0.5">
              {mySpaces.map((ws) => (
                <SpaceButton
                  key={ws.id}
                  workspace={ws}
                  active={ws.id === activeId}
                  collapsed={collapsed}
                  onClick={() => onSelect(ws.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Shared with me - hidden entirely when nothing is shared, matching
            the chip row's behaviour. */}
        {sharedSpaces.length > 0 && (
          <div className={`mt-4 ${collapsed ? 'px-1.5' : 'px-3'}`}>
            {collapsed ? (
              <div className="mx-1 mb-1.5 border-t" />
            ) : (
              <div className="flex items-center gap-1.5 mb-1.5">
                <Users className="size-3 text-muted-foreground" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex-1">
                  Shared with me
                </span>
              </div>
            )}
            <div className="space-y-0.5">
              {sharedSpaces.map((ws) => (
                <SpaceButton
                  key={ws.id}
                  workspace={ws}
                  active={ws.id === activeId}
                  collapsed={collapsed}
                  onClick={() => onSelect(ws.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** One Space row. Collapsed, it degrades to an initial-letter tile with the name as a tooltip. */
function SpaceButton({
  workspace, active, collapsed, onClick,
}: { workspace: KnownWorkspace; active: boolean; collapsed: boolean; onClick: () => void }) {
  if (collapsed) {
    return (
      <button
        onClick={onClick}
        title={workspace.name}
        className={`w-full flex items-center justify-center py-2 rounded-md text-xs font-semibold transition-colors ${
          active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
        }`}
      >
        {workspace.name.charAt(0).toUpperCase() || '?'}
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      title={workspace.name}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors ${
        active
          ? 'bg-muted font-semibold text-foreground'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
      }`}
    >
      <FolderLock className="size-3.5 shrink-0" />
      <span className="truncate flex-1 text-left">{workspace.name}</span>
    </button>
  );
}
