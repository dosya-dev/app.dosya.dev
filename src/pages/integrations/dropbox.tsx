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

const meta = getIntegration('dropbox')!;

export default function DropboxSetup() {
  const [pickerOpen, setPickerOpen] = useState(false);
  // Which account the picker preselects; null = the picker's own default.
  const [pickerAccountId, setPickerAccountId] = useState<string | null>(null);

  return (
    <IntegrationLayout icon={meta.icon} iconSrc={meta.iconSrc} title={meta.title} description={meta.description}>
      <CloudConnectNotice />
      <Step n={1} title="Connect your Dropbox account">
        <p>Sign in with your Dropbox account to import files from it:</p>
        <a
          href={`${API_BASE}/api/cloud/connect/dropbox`}
          className="mt-1 inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
        >
          <img src="/dropbox-color.svg" alt="" className="size-4" /> Connect Dropbox
        </a>
        <ConnectedAccountsCard
          provider="dropbox"
          onImport={(accountId) => { setPickerAccountId(accountId); setPickerOpen(true); }}
        />
      </Step>
      <Step n={2} title="Import your files">
        <p>
          Once connected, import files straight from Dropbox into any workspace. Manage or disconnect your
          Dropbox accounts anytime in{' '}
          <Link to="/profile#section-integrations" className="underline underline-offset-2 hover:text-foreground">
            Profile → Integrations
          </Link>
          .
        </p>
      </Step>
      <Step n={3} title="Choose what to import">
        <p>Browse your Dropbox and pick the folders or files you want. Folder structure is preserved.</p>
        <Button className="mt-2" onClick={() => { setPickerAccountId(null); setPickerOpen(true); }}>
          Import from Dropbox
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
