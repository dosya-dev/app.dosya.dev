import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WorkspaceState {
  activeId: string;
  setActiveId: (id: string) => void;
}

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set) => ({
      activeId: '',
      setActiveId: (id) => set({ activeId: id }),
    }),
    { name: 'dosya_active_ws' },
  ),
);
