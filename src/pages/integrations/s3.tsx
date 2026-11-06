import { Link } from 'react-router-dom';
import { IntegrationLayout, ApiKeyCallout, Step } from '@/components/integrations/integration-layout';
import { CodeBlock } from '@/components/integrations/code-block';
import { useIntegrationCtx } from '@/hooks/use-integration-ctx';
import { usePermissions } from '@/hooks/use-permissions';
import { Lock } from 'lucide-react';
import { getIntegration, s3Endpoint, S3_REGION, s3AwsConfig, s3Examples } from '@/lib/integrations';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';

const meta = getIntegration('s3')!;

export default function S3Setup() {
  const t = useT();
  const ctx = useIntegrationCtx();
  // The door itself is per role (access_s3); the key made below is refused at
  // it. Saying so here beats a setup walkthrough that ends in a 403 from a
  // mount dialog. Only a RESOLVED map says no - the hook fails open.
  const { can, isResolved } = usePermissions();
  const noAccess = isResolved && !can('access_s3');
  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      {noAccess && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <Lock className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="text-sm">
            <p className="font-medium">{t('integrations-s3.description.yourRoleCanRsquoTUseTheS3Gateway')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('common.description.anyCredentialsYouSetUpBelowWillBeRefusedForThis')}
            </p>
          </div>
        </div>
      )}
      <ApiKeyCallout />
      <Step n={1} title={t('integrations-s3.tooltip.generateS3Credentials')}>
        <p>
          {richText(t('integrations-s3.description.s3ToolsUseAnAccessKeySecretPairAttachOne'), {
            link1: (
              <Link to="/profile/api" className="underline underline-offset-2 hover:text-foreground">
                {t('common.action.profileApiKeys')}
              </Link>
            ),
          })}
        </p>
      </Step>
      <Step n={2} title={t('integrations-s3.tooltip.connectionSettings')}>
        <CodeBlock
          lang="text"
          code={[
            `Endpoint   ${s3Endpoint()}`,
            `Region     ${S3_REGION}`,
            `Bucket     ${ctx.workspaceId}`,
          ].join('\n')}
        />
      </Step>
      <Step n={3} title={t('integrations-s3.tooltip.awsCli')}>
        <p>{t('integrations-s3.label.storeYourCredentials')}</p>
        <CodeBlock code={s3AwsConfig()} lang="bash" />
        <p>{t('integrations-s3.label.thenOperateOnYourWorkspaceBucket')}</p>
        <CodeBlock code={s3Examples(ctx)} lang="bash" />
      </Step>
    </IntegrationLayout>
  );
}
