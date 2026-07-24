import { Link } from 'react-router-dom';
import { IntegrationLayout, Step } from '@/components/integrations/integration-layout';
import { CodeBlock } from '@/components/integrations/code-block';
import { getIntegration, API_HOST, restExample } from '@/lib/integrations';

const meta = getIntegration('rest-api')!;

export default function RestApiSetup() {
  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      <Step n={1} title="Create a token">
        <p>
          Generate a <code>dos_…</code> token in{' '}
          <Link to="/profile#section-api" className="underline underline-offset-2 hover:text-foreground">
            Profile → API keys
          </Link>{' '}
          with the scope you need (read, upload or full).
        </p>
      </Step>
      <Step n={2} title="Call the API">
        <p>Base URL is <code>{API_HOST}</code>. Authenticate with a bearer token:</p>
        <CodeBlock code={restExample()} lang="bash" />
      </Step>
      <Step n={3} title="Reference">
        <p>
          Every endpoint is documented in the{' '}
          <a
            href="https://dosya.dev/developer/api"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            API documentation
          </a>
          .
        </p>
      </Step>
    </IntegrationLayout>
  );
}
