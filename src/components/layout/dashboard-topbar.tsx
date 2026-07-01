import { useState, useEffect, useRef, useCallback } from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Search, Bell, User, LogOut, Settings, CreditCard, HelpCircle, Sun, Moon } from 'lucide-react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { api, API_BASE } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { humanSize, colorFor, labelFor, initials } from '@/lib/helpers';
import { titleForPath, iconForPath } from '@/lib/page-title';

interface UserInfo {
  name: string;
  email: string;
  avatar_url: string | null;
}

interface SearchResult {
  files: { id: string; name: string; size_bytes: number; extension: string; folder_id: string | null; uploader_name: string }[];
  folders: { id: string; name: string; file_count: number }[];
  shared: { file_name: string; sharer_name: string; view_count: number; status: string }[];
  file_requests: { title: string; created_by_name: string; upload_count: number; is_revoked: number; expires_at: number | null }[];
}

export function DashboardTopbar() {
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const navigate = useNavigate();
  const location = useLocation();
  const PageIcon = iconForPath(location.pathname);
  const pageLabel = titleForPath(location.pathname);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Load user info
  useEffect(() => {
    (async () => {
      try {
        const data = await api<{ ok: boolean; user: UserInfo }>('/api/me');
        if (data.ok) setUser(data.user);
      } catch { /* */ }
    })();
  }, []);

  // Theme toggle
  const toggleTheme = () => {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    setDark(isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  };

  // Logout
  const logout = async () => {
    await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    window.location.href = '/login';
  };

  // Search
  const performSearch = useCallback(async (q: string) => {
    if (!wsId || q.length < 2) { setSearchResults(null); setSearchOpen(false); return; }
    setSearching(true);
    setSearchOpen(true);
    try {
      const data = await api<{ ok: boolean } & SearchResult>(`/api/search?workspace_id=${wsId}&q=${encodeURIComponent(q)}`);
      if (data.ok) setSearchResults(data);
    } catch { /* */ }
    setSearching(false);
  }, [wsId]);

  const onSearchInput = (val: string) => {
    setSearchQuery(val);
    clearTimeout(debounceRef.current);
    if (val.trim().length < 2) { setSearchOpen(false); return; }
    debounceRef.current = setTimeout(() => performSearch(val.trim()), 250);
  };

  // "/" shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement).closest('input, textarea, [contenteditable]')) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Close search on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const totalResults = searchResults ? searchResults.files.length + searchResults.folders.length + searchResults.shared.length + searchResults.file_requests.length : 0;

  return (
    <header className="flex h-14 items-center gap-3 border-b px-4 shrink-0">
      <SidebarTrigger />
      <Separator orientation="vertical" className="self-stretch! my-3" />

      {/* Page title + icon */}
      {pageLabel && (
        <>
          <div className="hidden md:flex items-center gap-2 shrink-0">
            {PageIcon && <PageIcon className="size-4 text-muted-foreground" />}
            <span className="text-sm font-semibold whitespace-nowrap">{pageLabel}</span>
          </div>
          <Separator orientation="vertical" className="self-stretch! my-3 hidden md:block" />
        </>
      )}

      {/* Search */}
      <div className="relative flex-1 max-w-[420px]" ref={searchRef}>
        <div className="flex items-center gap-2 border rounded-lg px-3 h-8 bg-card">
          <Search className="size-3.5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchInput(e.target.value)}
            onFocus={() => { if (searchQuery.trim().length >= 2) setSearchOpen(true); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchQuery.trim()) {
                setSearchOpen(false);
                navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
              }
            }}
            placeholder="Search files, folders, people..."
            className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground"
          />
          {!searchOpen && <kbd className="text-[10px] font-medium text-muted-foreground bg-muted border rounded px-1.5 py-0.5 leading-none">/</kbd>}
        </div>

        {/* Search dropdown */}
        {searchOpen && (
          <div className="absolute top-[calc(100%+6px)] left-0 right-0 bg-card border rounded-xl shadow-xl z-[600] max-h-[420px] overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-100">
            {searching ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Searching...</p>
            ) : totalResults === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No results for "{searchQuery}"</p>
            ) : (
              <div className="py-1.5">
                {searchResults!.files.length > 0 && (
                  <>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3.5 pt-2 pb-1">Files</p>
                    {searchResults!.files.slice(0, 5).map((f) => (
                      <Link key={f.id} to={`/files${f.folder_id ? '?folder=' + f.folder_id : ''}`} className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-muted/50 no-underline" onClick={() => setSearchOpen(false)}>
                        <div className="w-7 h-7 rounded-md flex items-center justify-center text-[7px] font-bold text-white shrink-0" style={{ background: colorFor(f.name) }}>{labelFor(f.name)}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate text-foreground">{f.name}</p>
                          <p className="text-[10px] text-muted-foreground">{humanSize(f.size_bytes)}{f.uploader_name ? ` · ${f.uploader_name}` : ''}</p>
                        </div>
                      </Link>
                    ))}
                  </>
                )}
                {searchResults!.folders.length > 0 && (
                  <>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3.5 pt-2 pb-1">Folders</p>
                    {searchResults!.folders.slice(0, 4).map((f) => (
                      <Link key={f.id} to={`/files?folder=${f.id}`} className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-muted/50 no-underline" onClick={() => setSearchOpen(false)}>
                        <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center shrink-0"><Search className="size-3.5 text-muted-foreground" /></div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate text-foreground">{f.name}</p>
                          <p className="text-[10px] text-muted-foreground">{f.file_count} files</p>
                        </div>
                      </Link>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Theme toggle */}
        <Button variant="outline" size="sm" className="size-9 p-0" onClick={toggleTheme}>
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>

        {/* Notifications */}
        <Button variant="outline" size="sm" className="size-9 p-0 relative">
          <Bell className="size-4" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-green-500 rounded-full" />
        </Button>

        {/* Profile */}
        <DropdownMenu>
          <DropdownMenuTrigger>
            <div className="size-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold cursor-pointer overflow-hidden">
              {user?.avatar_url ? (
                <img src={`${API_BASE}/api/me/avatar`} alt="" crossOrigin="use-credentials" className="w-full h-full object-cover" />
              ) : (
                initials(user?.name || '?')
              )}
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {user && (
              <>
                <div className="px-3 py-2">
                  <p className="text-sm font-semibold">{user.name}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
                <DropdownMenuSeparator />
              </>
            )}
            <Link to="/profile"><DropdownMenuItem><User className="size-3.5 mr-2" /> Profile</DropdownMenuItem></Link>
            <Link to="/settings"><DropdownMenuItem><Settings className="size-3.5 mr-2" /> Settings</DropdownMenuItem></Link>
            <Link to="/billing"><DropdownMenuItem><CreditCard className="size-3.5 mr-2" /> Billing</DropdownMenuItem></Link>
            <a href="/help"><DropdownMenuItem><HelpCircle className="size-3.5 mr-2" /> Help</DropdownMenuItem></a>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={logout}><LogOut className="size-3.5 mr-2" /> Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
