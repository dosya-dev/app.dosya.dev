// The AI search section of workspace Settings (section id `ai`; settings.tsx
// owns the <section id="section-ai"> wrapper the nav scrolls to).
//
// GET  /api/workspaces/:id/ai-search  settings + status, any member
// PUT  same path                      owner or change_ai_search: { enabled?, index_existing?, excluded_folders? }
//
// Only the controls live here; the indexing status is a card on the
// workspace dashboard (pages/dashboard.tsx) and the account-wide unit pool is
// on Billing. `status.limits === null` means the owner's plan has no AI
// search: the switch is disabled with the upgrade text (but stays usable to
// switch OFF a workspace that is still on after a downgrade).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderX, Loader2, Plus, X } from 'lucide-react';
import { api, apiErrorCode, apiErrorMessage } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FolderPickerDialog } from '@/components/folder-picker-dialog';
import { toast } from '@/lib/toast';
import { useT } from '@/lib/i18n';
import {
  fetchWorkspaceAiSearch, forgetContentAvailability,
  type AiSearchSettings, type AiSearchStatus,
} from '@/lib/ai-search';

const PLANS_LINK = 'inline-flex h-7 items-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted';

export function AiSearchSection({ wsId }: { wsId: string }) {
  const t = useT();
  const [data, setData] = useState<{ settings: AiSearchSettings; status: AiSearchStatus; canEdit: boolean } | null>(null);
  const [saving, setSaving] = useState<keyof AiSearchSettings | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [folderNames, setFolderNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetchWorkspaceAiSearch(wsId);
      if (res) setData({ settings: res.settings, status: res.status, canEdit: res.can_edit });
    } catch { /* the section stays hidden: AI search is optional */ }
  }, [wsId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetches the section's data; state is set after the request
  useEffect(() => { void load(); }, [load]);

  // Excluded folders arrive as bare ids; resolve names the way the API keys
  // section does, through GET /api/folders/:id.
  const excluded = data?.settings.excluded_folders;
  useEffect(() => {
    const missing = (excluded ?? []).filter((id) => !(id in folderNames));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(missing.map(async (id) => {
        try {
          const res = await api<{ ok?: boolean; folder?: { name?: string } }>(`/api/folders/${id}`);
          return [id, res?.ok && res.folder?.name ? res.folder.name : t('file-requests.label.unknownFolder')] as const;
        } catch {
          return [id, t('file-requests.label.unknownFolder')] as const;
        }
      }));
      if (!cancelled) setFolderNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    })();
    return () => { cancelled = true; };
  }, [excluded, folderNames, t]);

  const header = (
    <div className="mb-3">
      <h2 className="text-base font-semibold">{t('settings.label.aiSearch')}</h2>
      <p className="text-xs text-muted-foreground mt-0.5">{t('settings.description.findsFilesByWhatTheyAreAboutByTextInsideDocumentsAndImages')}</p>
    </div>
  );
  // Until the first answer (or when it fails) only the heading shows, so the
  // settings nav entry still has somewhere to scroll to.
  if (!data) return header;
  const { settings, status, canEdit } = data;
  const inPlan = status.limits !== null;

  const save = async (field: keyof AiSearchSettings, body: Partial<AiSearchSettings>) => {
    setSaving(field);
    try {
      const res = await api<{ ok: boolean; settings?: AiSearchSettings }>(`/api/workspaces/${wsId}/ai-search`, { method: 'PUT', body: JSON.stringify(body) });
      if (res?.settings) setData((d) => (d ? { ...d, settings: res.settings! } : d));
      forgetContentAvailability(wsId);
      toast.success(t('settings.feedback.settingsUpdated'));
      void load();
    } catch (err) {
      const code = apiErrorCode(err);
      const msg = code === 'ai_search_not_in_plan' ? t('settings.description.aiSearchIsAvailableOnPaidPlans')
        : code === 'ai_search_needs_object_home' || code === 'ai_search_unavailable_for_vault' ? t('settings.error.aiSearchIsNotAvailableForThisWorkspace')
        : code === 'rate_limited' ? t('settings.error.tooManyChangesTryAgainInAMinute')
        : apiErrorMessage(err);
      toast.error(t('common.error.couldnTSave'), msg);
    }
    setSaving(null);
  };

  // Switching ON needs the plan; switching OFF is always allowed.
  const switchDisabled = !canEdit || saving !== null || (!inPlan && !settings.enabled);
  const controlsDisabled = !canEdit || saving !== null;

  const switchDesc = !inPlan ? t('settings.description.aiSearchIsAvailableOnPaidPlans')
    : !canEdit ? t('settings.description.youDoNotHavePermissionToChangeAiSearch')
    : null;

  const addFolder = (id: string | null) => {
    setPickerOpen(false);
    if (!id || settings.excluded_folders.includes(id)) return;
    void save('excluded_folders', { excluded_folders: [...settings.excluded_folders, id] });
  };
  const removeFolder = (id: string) => {
    void save('excluded_folders', { excluded_folders: settings.excluded_folders.filter((f) => f !== id) });
  };

  return (
    <>
      {header}

      <Card className="mb-4">
        <CardContent className="divide-y">
          <Row label={t('settings.label.searchInsideFilesAndPhotos')} desc={switchDesc}>
            <div className="flex items-center gap-2">
              {!inPlan && <Link to="/billing" className={PLANS_LINK}>{t('common.action.seePlans')}</Link>}
              <button
                type="button"
                role="switch"
                aria-checked={settings.enabled}
                aria-label={t('settings.label.searchInsideFilesAndPhotos')}
                className={`relative w-9 h-5 rounded-full transition-colors ${settings.enabled ? 'bg-green-600' : 'bg-muted'} ${switchDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={switchDisabled}
                onClick={() => void save('enabled', { enabled: !settings.enabled })}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${settings.enabled ? 'inset-s-4.5' : 'inset-s-0.5'}`} />
              </button>
            </div>
          </Row>

          <Row label={t('settings.label.alsoIndexExistingFiles')}>
            <label className="flex items-center gap-2">
              {saving === 'index_existing' && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
              <Checkbox
                checked={settings.index_existing}
                disabled={controlsDisabled}
                aria-label={t('settings.label.alsoIndexExistingFiles')}
                onCheckedChange={(v) => void save('index_existing', { index_existing: v === true })}
              />
            </label>
          </Row>

          <div className="py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t('settings.label.excludeFolders')}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t('settings.description.filesInTheseFoldersAreNotIndexed')}</p>
              </div>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1 shrink-0" disabled={controlsDisabled} onClick={() => setPickerOpen(true)}>
                {saving === 'excluded_folders' ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}{t('settings.action.addFolder')}
              </Button>
            </div>
            {settings.excluded_folders.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {settings.excluded_folders.map((id) => (
                  <li key={id} className="inline-flex items-center gap-1 rounded-md border bg-muted/40 ps-2 pe-1 py-0.5 text-xs">
                    <FolderX className="size-3 text-muted-foreground" />
                    <span className="truncate max-w-48" dir="auto">{folderNames[id] ?? '…'}</span>
                    <button
                      type="button"
                      className="rounded p-0.5 hover:bg-muted disabled:opacity-50"
                      aria-label={t('common.remove')}
                      disabled={controlsDisabled}
                      onClick={() => removeFolder(id)}
                    ><X className="size-3" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {settings.enabled && (
        <p className="mb-4 text-xs text-muted-foreground">
          <Link to="/" className="font-medium text-foreground underline underline-offset-2 hover:no-underline">{t('settings.action.seeIndexingStatusOnTheDashboard')}</Link>
        </p>
      )}

      {pickerOpen && (
        <FolderPickerDialog
          open
          onClose={() => setPickerOpen(false)}
          workspaceId={wsId}
          onSelect={(id) => addFolder(id)}
          title={t('settings.label.excludeFolders')}
          confirmLabel={t('settings.action.addFolder')}
        />
      )}
    </>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-4 gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
