import { IntegrationLayout, ApiKeyCallout, Step } from '@/components/integrations/integration-layout';
import { CodeBlock } from '@/components/integrations/code-block';
import { useIntegrationCtx } from '@/hooks/use-integration-ctx';
import { getIntegration, rcloneInstall, rcloneConfig, rcloneExamples } from '@/lib/integrations';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';

const meta = getIntegration('rclone')!;

export default function RcloneSetup() {
  const t = useT();
  const ctx = useIntegrationCtx();
  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      <ApiKeyCallout />
      <Step n={1} title={t('integrations-rclone.tooltip.installTheDosyaRcloneBuild')}>
        <p>{t('integrations-rclone.description.dosyaShipsASmallForkOfRcloneWithANativeBackend')}</p>
        <CodeBlock code={rcloneInstall} lang="bash" />
      </Step>
      <Step n={2} title={t('integrations-rclone.tooltip.configureTheRemote')}>
        <p>
          {richText(t('integrations-rclone.description.addThisBlockToYourEmphasis1RunEmphasis2ToFindIt'), {
            emphasis1: <code>rclone.conf</code>,
            emphasis2: <code>rclone config file</code>,
          })}
        </p>
        <CodeBlock code={rcloneConfig(ctx)} lang="ini" caption="rclone.conf" />
      </Step>
      <Step n={3} title={t('integrations-rclone.tooltip.useIt')}>
        <p>
          {richText(t('integrations-rclone.description.yourWorkspaceIsNowTheEmphasis1Remote'), { emphasis1: <code>dosya:</code> })}
        </p>
        <CodeBlock code={rcloneExamples} lang="bash" />
      </Step>
    </IntegrationLayout>
  );
}
