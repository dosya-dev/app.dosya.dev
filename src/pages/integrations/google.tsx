import { useState } from 'react';
import { Link } from 'react-router-dom';
import { IntegrationLayout, Step } from '@/components/integrations/integration-layout';
import { Button } from '@/components/ui/button';
import { API_BASE } from '@/api/client';
import { getIntegration } from '@/lib/integrations';
import { ProviderPickerDialog } from '@/components/cloud-import/provider-picker-dialog';

const meta = getIntegration('google')!;

export default function GoogleSetup() {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <IntegrationLayout icon={meta.icon} iconSrc={meta.iconSrc} title={meta.title} description={meta.description}>
      <Step n={1} title="Connect your Google account">
        <p>Grant dosya read access to your Google Drive so you can import files from it:</p>
        <a
          href={`${API_BASE}/api/cloud/connect/google`}
          className="mt-1 inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
        >
          <img src="/google-color.svg" alt="" className="size-4" /> Connect Google Drive
        </a>
      </Step>
      <Step n={2} title="Import your files">
        <p>
          Once connected, import files straight from Drive into any workspace. Manage or disconnect your
          Google accounts anytime in{' '}
          <Link to="/profile#section-integrations" className="underline underline-offset-2 hover:text-foreground">
            Profile → Integrations
          </Link>
          .
        </p>
      </Step>
      <Step n={3} title="Choose what to import">
        <p>Browse your Drive and pick the folders or files you want. Folder structure is preserved.</p>
        <Button className="mt-2" onClick={() => setPickerOpen(true)}>Import from Google Drive</Button>
      </Step>
      <ProviderPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        provider="google"
        destFolderId={null}
      />
    </IntegrationLayout>
  );
}
