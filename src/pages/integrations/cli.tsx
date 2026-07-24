import { IntegrationLayout, ApiKeyCallout, Step } from '@/components/integrations/integration-layout';
import { CodeBlock } from '@/components/integrations/code-block';
import { getIntegration, cliInstall, cliInstallWindows, cliExamples } from '@/lib/integrations';

const meta = getIntegration('cli')!;

export default function CliSetup() {
  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      <ApiKeyCallout />
      <Step n={1} title="Install">
        <p>macOS and Linux:</p>
        <CodeBlock code={cliInstall} lang="bash" />
        <p>Windows (PowerShell):</p>
        <CodeBlock code={cliInstallWindows} lang="powershell" />
      </Step>
      <Step n={2} title="Sign in">
        <p>
          Run <code>dosya auth login</code> and paste an API key when prompted, or pass it directly with
          <code>--key dos_your_api_key</code> for headless setups.
        </p>
      </Step>
      <Step n={3} title="Everyday commands">
        <CodeBlock code={cliExamples} lang="bash" />
      </Step>
    </IntegrationLayout>
  );
}
