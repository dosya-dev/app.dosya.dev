import { IntegrationLayout, ApiKeyCallout, Step } from '@/components/integrations/integration-layout';
import { CodeBlock } from '@/components/integrations/code-block';
import { useIntegrationCtx } from '@/hooks/use-integration-ctx';
import { getIntegration, webdavUrl, webdavWindowsMount, webdavLinuxMount } from '@/lib/integrations';

const meta = getIntegration('webdav')!;

export default function WebdavSetup() {
  const ctx = useIntegrationCtx();
  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      <ApiKeyCallout />
      <Step n={1} title="Endpoint & credentials">
        <p>Connect any WebDAV client to this URL:</p>
        <CodeBlock code={webdavUrl(ctx)} lang="text" />
        <p>
          Sign in with <strong>HTTP Basic auth</strong> — username is your account email
          (<code>{ctx.email}</code>) and the password is your <code>dos_…</code> API key.
        </p>
      </Step>
      <Step n={2} title="macOS (Finder)">
        <p>Finder → Go → <em>Connect to Server…</em>, paste the URL, then enter your email and API key.</p>
      </Step>
      <Step n={3} title="Windows">
        <p>Map a network drive from an elevated prompt:</p>
        <CodeBlock code={webdavWindowsMount(ctx)} lang="powershell" />
      </Step>
      <Step n={4} title="Linux (davfs2)">
        <CodeBlock code={webdavLinuxMount(ctx)} lang="bash" />
      </Step>
    </IntegrationLayout>
  );
}
