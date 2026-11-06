// /personas/settings: this user's Personas settings for the active workspace
// (pages/settings/personas.tsx). Personas is each member's own, so it lives
// beside the People grid, gated like /personas, not in workspace Settings.
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { FilesSidebar } from '@/components/files-sidebar';
import { filterNavParams, groupNavParams } from '@/lib/files-params';
import { useT } from '@/lib/i18n';
import { PersonasSection } from '@/pages/settings/personas';
import { useWorkspace } from '@/stores/workspace';

export default function PersonasSettingsPage() {
  const t = useT();
  const navigate = useNavigate();
  const wsId = useWorkspace((s) => s.activeId);
  return (
    <div className="flex h-full overflow-hidden">
      <FilesSidebar
        onFilterChange={(filter) => navigate(`/files?${filterNavParams(new URLSearchParams(), filter)}`)}
        onFavouriteClick={() => navigate('/files')}
        onGroupClick={(groupId) => navigate(`/files?${groupNavParams(new URLSearchParams(), groupId)}`)}
      />
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="p-6 max-w-3xl mx-auto">
          <Link to="/personas" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
            <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
            {t('common.label.personas')}
          </Link>
          {wsId && <PersonasSection key={wsId} wsId={wsId} />}
        </div>
      </div>
    </div>
  );
}
