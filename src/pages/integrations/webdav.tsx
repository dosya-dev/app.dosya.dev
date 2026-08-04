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
          Sign in with <strong>HTTP Basic auth</strong> - username is your account email
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
      <Step n={5} title="Limiting a key to one folder">
        <p>
          A key does not have to reach your whole workspace. When you create one on your{' '}
          <a href="/profile">profile page</a>, you can pin it to a workspace and anchor it at a
          single folder. Mount that key and the folder becomes the root - everything above and
          beside it is not just hidden, it is unreachable, including by typing a path directly.
        </p>
        <p>
          A folder-anchored key works over WebDAV and the S3 gateway. It is deliberately refused
          on the REST API and SFTP, because those do not apply the folder limit yet, and a
          restriction that silently does not apply is worse than none.
        </p>
        <p>
          Two things worth knowing. An anchored mount does not show the{' '}
          <code>Documents</code>, <code>Videos</code>, <code>Images</code>, <code>Shared</code>{' '}
          and <code>Deleted</code> smart views, because those span the whole workspace. And if
          you move the anchor folder to the trash, the key stops working until you restore it.
        </p>
      </Step>
      <Step n={6} title="Limiting a key to certain protocols">
        <p>
          The same creation form lets you tick which protocols a key may use - WebDAV, SFTP, the
          S3 gateway, the REST API - in any combination. Leave them all unticked and the key
          works everywhere, which is how every key made before this existed behaves.
        </p>
        <p>
          This is per key, not per person. If you want a credential that can only mount a drive
          and can never call the API, make one that is WebDAV-only and use it for that.
        </p>
      </Step>
    </IntegrationLayout>
  );
}
