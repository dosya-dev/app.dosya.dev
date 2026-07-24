import { Link } from 'react-router-dom';
import { IntegrationLayout, ApiKeyCallout, Step } from '@/components/integrations/integration-layout';
import { CodeBlock } from '@/components/integrations/code-block';
import { useIntegrationCtx } from '@/hooks/use-integration-ctx';
import { getIntegration, s3Endpoint, S3_REGION, s3AwsConfig, s3Examples } from '@/lib/integrations';

const meta = getIntegration('s3')!;

export default function S3Setup() {
  const ctx = useIntegrationCtx();
  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      <ApiKeyCallout />
      <Step n={1} title="Generate S3 credentials">
        <p>
          S3 tools use an access key / secret pair. Attach one to an API key in{' '}
          <Link to="/profile#section-api" className="underline underline-offset-2 hover:text-foreground">
            Profile → API keys
          </Link>{' '}
          (the secret is shown once — copy it then).
        </p>
      </Step>
      <Step n={2} title="Connection settings">
        <CodeBlock
          lang="text"
          code={[
            `Endpoint   ${s3Endpoint()}`,
            `Region     ${S3_REGION}`,
            `Bucket     ${ctx.workspaceId}`,
          ].join('\n')}
        />
      </Step>
      <Step n={3} title="AWS CLI">
        <p>Store your credentials:</p>
        <CodeBlock code={s3AwsConfig()} lang="bash" />
        <p>Then operate on your workspace bucket:</p>
        <CodeBlock code={s3Examples(ctx)} lang="bash" />
      </Step>
    </IntegrationLayout>
  );
}
