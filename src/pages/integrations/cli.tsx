import { IntegrationLayout, ApiKeyCallout, Step } from '@/components/integrations/integration-layout';
import { CodeBlock } from '@/components/integrations/code-block';
import { getIntegration, cliInstall, cliInstallWindows, cliExamples } from '@/lib/integrations';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';

const meta = getIntegration('cli')!;

export default function CliSetup() {
  const t = useT();
  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      <ApiKeyCallout />
      <Step n={1} title={t('common.tooltip.install')}>
        <p>{t('integrations-cli.label.macosAndLinux')}</p>
        <CodeBlock code={cliInstall} lang="bash" />
        <p>{t('integrations-cli.label.windowsPowershell')}</p>
        <CodeBlock code={cliInstallWindows} lang="powershell" />
      </Step>
      <Step n={2} title={t('common.action.signIn')}>
        <p>
          {richText(t('integrations-cli.description.runEmphasis1AndPasteAnApiKeyWhenPromptedOrPass'), {
            emphasis1: <code>dosya auth login</code>,
            emphasis2: <code>--key dos_your_api_key</code>,
          })}
        </p>
      </Step>
      <Step n={3} title={t('integrations-cli.tooltip.everydayCommands')}>
        <CodeBlock code={cliExamples} lang="bash" />
      </Step>
      <Step n={4} title={t('integrations-cli.tooltip.fullReference')}>
        <p>
          {richText(t('integrations-cli.description.seeTheLink1ForEveryCommandAndFlag'), {
            link1: (
              <a
                href={meta.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {t('integrations-cli.action.cliDocumentation')}
              </a>
            ),
          })}
        </p>
      </Step>
    </IntegrationLayout>
  );
}
