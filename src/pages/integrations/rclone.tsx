import { IntegrationLayout, ApiKeyCallout, Step } from '@/components/integrations/integration-layout';
import { CodeBlock } from '@/components/integrations/code-block';
import { useIntegrationCtx } from '@/hooks/use-integration-ctx';
import { getIntegration, rcloneInstall, rcloneConfig, rcloneExamples } from '@/lib/integrations';

const meta = getIntegration('rclone')!;

export default function RcloneSetup() {
  const ctx = useIntegrationCtx();
  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      <ApiKeyCallout />
      <Step n={1} title="Install the dosya rclone build">
        <p>dosya ships a small fork of rclone with a native backend. Install it with Go:</p>
        <CodeBlock code={rcloneInstall} />
      </Step>
      <Step n={2} title="Configure the remote">
        <p>Add this block to your <code>rclone.conf</code> (run <code>rclone config file</code> to find it):</p>
        <CodeBlock code={rcloneConfig(ctx)} caption="rclone.conf" />
      </Step>
      <Step n={3} title="Use it">
        <p>Your workspace is now the <code>dosya:</code> remote.</p>
        <CodeBlock code={rcloneExamples} />
      </Step>
    </IntegrationLayout>
  );
}
