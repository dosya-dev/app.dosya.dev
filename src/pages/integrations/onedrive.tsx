import { useState } from 'react';
import { Link } from 'react-router-dom';
import { IntegrationLayout, Step } from '@/components/integrations/integration-layout';
import { Button } from '@/components/ui/button';
import { API_BASE } from '@/api/client';
import { getIntegration } from '@/lib/integrations';
import { ProviderPickerDialog } from '@/components/cloud-import/provider-picker-dialog';
import { ConnectedAccountsCard } from '@/components/cloud-import/connected-accounts-card';

const meta = getIntegration('onedrive')!;

export default function OneDriveSetup() {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <IntegrationLayout icon={meta.icon} iconSrc={meta.iconSrc} title={meta.title} description={meta.description}>
      <Step n={1} title="Connect your Microsoft account">
        <p>Sign in with your Microsoft account - personal or work/school - to import files from your OneDrive:</p>
        <a
          href={`${API_BASE}/api/cloud/connect/onedrive`}
          className="mt-1 inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
        >
          <img src="/onedrive-color.svg" alt="" className="size-4" /> Connect OneDrive
        </a>
        <ConnectedAccountsCard provider="onedrive" />
      </Step>
      <Step n={2} title="Import your files">
        <p>
          Once connected, import files straight from OneDrive into any workspace. Manage or disconnect your
          Microsoft accounts anytime in{' '}
          <Link to="/profile#section-integrations" className="underline underline-offset-2 hover:text-foreground">
            Profile → Integrations
          </Link>
          .
        </p>
      </Step>
      <Step n={3} title="Choose what to import">
        <p>Browse your OneDrive and pick the folders or files you want. Folder structure is preserved.</p>
        <Button className="mt-2" onClick={() => setPickerOpen(true)}>Import from OneDrive</Button>
      </Step>
      <ProviderPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        provider="onedrive"
        destFolderId={null}
      />
    </IntegrationLayout>
  );
}
