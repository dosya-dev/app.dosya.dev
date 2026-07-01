import { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { DashboardSidebar } from './dashboard-sidebar';
import { DashboardTopbar } from './dashboard-topbar';

export function DashboardLayout() {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' })
      .then((res) => {
        if (res.ok) {
          setAuthed(true);
        } else {
          setAuthed(false);
          navigate('/login', { replace: true });
        }
      })
      .catch(() => {
        setAuthed(false);
        navigate('/login', { replace: true });
      });
  }, [navigate]);

  if (authed === null) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!authed) return null;

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <DashboardSidebar />
      <SidebarInset className="min-h-0 overflow-hidden">
        <DashboardTopbar />
        <main className="flex-1 min-h-0 overflow-y-auto">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
