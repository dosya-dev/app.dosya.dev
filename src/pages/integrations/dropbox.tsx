import { useState } from 'react';
import { Link } from 'react-router-dom';
import { IntegrationLayout, Step } from '@/components/integrations/integration-layout';
import { Button } from '@/components/ui/button';
import { API_BASE } from '@/api/client';
import { getIntegration } from '@/lib/integrations';
import { ProviderPickerDialog } from '@/components/cloud-import/provider-picker-dialog';
import { ConnectedAccountsCard } from '@/components/cloud-import/connected-accounts-card';
import { CloudConnectNotice } from '@/components/cloud-import/cloud-connect-notice';
import { ImportProgressCard } from '@/components/cloud-import/import-progress-card';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';

const meta = getIntegration('dropbox')!;

export default function DropboxSetup() {
  const t = useT();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Which account the picker preselects; null = the picker's own default.
  const [pickerAccountId, setPickerAccountId] = useState<string | null>(null);

  return (
    <IntegrationLayout icon={meta.icon} iconSrc={meta.iconSrc} title={meta.title} description={meta.description}>
      <CloudConnectNotice />
      <Step n={1} title={t('integrations-dropbox.tooltip.connectYourDropboxAccount')}>
        <p>{t('integrations-dropbox.description.signInWithYourDropboxAccountToImportFilesFromIt')}</p>
        <a
          href={`${API_BASE}/api/cloud/connect/dropbox`}
          className="whitespace-nowrap mt-1 inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
        >
          <img src="/dropbox-color.svg" alt="" className="size-4" /> {t('integrations-dropbox.action.connectDropbox')}
        </a>
        <ConnectedAccountsCard
          provider="dropbox"
          onImport={(accountId) => { setPickerAccountId(accountId); setPickerOpen(true); }}
        />
      </Step>
      <Step n={2} title={t('common.tooltip.importYourFiles')}>
        <p>
          {richText(t('integrations-dropbox.description.onceConnectedImportFilesStraightFromDropboxIntoAnyWorkspaceManage'), {
            link1: (
              <Link to="/profile/integrations" className="underline underline-offset-2 hover:text-foreground">
                {t('common.action.profileIntegrations')}
              </Link>
            ),
          })}
        </p>
      </Step>
      <Step n={3} title={t('common.tooltip.chooseWhatToImport')}>
        <p>{t('integrations-dropbox.description.browseYourDropboxAndPickTheFoldersOrFilesYouWant')}</p>
        <Button className="mt-2" onClick={() => { setPickerAccountId(null); setPickerOpen(true); }}>
          {t('integrations-dropbox.action.importFromDropbox')}
        </Button>
      </Step>
      <div className="mt-4 empty:hidden">
        <ImportProgressCard provider="dropbox" />
      </div>
      <ProviderPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        provider="dropbox"
        destFolderId={null}
        initialAccountId={pickerAccountId}
      />
    </IntegrationLayout>
  );
}
