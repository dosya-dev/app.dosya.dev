import { IntegrationLayout, ApiKeyCallout, Step } from '@/components/integrations/integration-layout';
import { CodeBlock } from '@/components/integrations/code-block';
import { useIntegrationCtx } from '@/hooks/use-integration-ctx';
import { getIntegration, SFTP_HOST, SFTP_PORT, sftpConnect, sftpConfig } from '@/lib/integrations';

const meta = getIntegration('sftp')!;

export default function SftpSetup() {
  const ctx = useIntegrationCtx();
  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      <ApiKeyCallout />
      <Step n={1} title="Connect from the terminal">
        <p>
          Username is your account email (<code>{ctx.email}</code>) and the password prompt takes your
          <code>dos_…</code> API key:
        </p>
        <CodeBlock code={sftpConnect(ctx)} lang="bash" />
      </Step>
      <Step n={2} title="GUI clients (FileZilla, WinSCP, Cyberduck)">
        <CodeBlock
          lang="text"
          code={[
            'Protocol   SFTP',
            `Host       ${SFTP_HOST}`,
            `Port       ${SFTP_PORT}`,
            `User       ${ctx.email}`,
            'Password   dos_your_api_key',
          ].join('\n')}
        />
      </Step>
      <Step n={3} title="Save a shortcut (~/.ssh/config)">
        <p>Add this so you can just run <code>sftp dosya</code>:</p>
        <CodeBlock code={sftpConfig(ctx)} lang="text" caption="~/.ssh/config" />
      </Step>
    </IntegrationLayout>
  );
}
