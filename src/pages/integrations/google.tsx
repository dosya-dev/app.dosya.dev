import { Link } from 'react-router-dom';
import { IntegrationLayout, Step } from '@/components/integrations/integration-layout';
import { API_BASE } from '@/api/client';
import { getIntegration } from '@/lib/integrations';

const meta = getIntegration('google')!;

export default function GoogleSetup() {
  return (
    <IntegrationLayout icon={meta.icon} iconSrc={meta.iconSrc} title={meta.title} description={meta.description}>
      <Step n={1} title="Connect your Google account">
        <p>Grant dosya read access to your Google Drive so you can import files from it:</p>
        <a
          href={`${API_BASE}/api/drive/connect`}
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
    </IntegrationLayout>
  );
}
