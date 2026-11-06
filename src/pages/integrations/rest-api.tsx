import { Link } from 'react-router-dom';
import { IntegrationLayout, Step } from '@/components/integrations/integration-layout';
import { CodeBlock } from '@/components/integrations/code-block';
import { getIntegration, API_HOST, restExample } from '@/lib/integrations';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';

const meta = getIntegration('rest-api')!;

export default function RestApiSetup() {
  const t = useT();
  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      <Step n={1} title={t('integrations-rest-api.tooltip.createAToken')}>
        <p>
          {richText(t('integrations-rest-api.description.generateAEmphasis1TokenInLink1WithTheScopeYouNeed'), {
            emphasis1: <code>dos_…</code>,
            link1: (
              <Link to="/profile/api" className="underline underline-offset-2 hover:text-foreground">
                {t('common.action.profileApiKeys')}
              </Link>
            ),
          })}
        </p>
      </Step>
      <Step n={2} title={t('integrations-rest-api.tooltip.callTheApi')}>
        <p>
          {richText(t('integrations-rest-api.description.baseUrlIsEmphasis1AuthenticateWithABearerToken'), {
            emphasis1: <code>{API_HOST}</code>,
          })}
        </p>
        <CodeBlock code={restExample()} lang="bash" />
      </Step>
      <Step n={3} title={t('integrations-rest-api.tooltip.reference')}>
        <p>
          {richText(t('integrations-rest-api.description.everyEndpointIsDocumentedInTheLink1'), {
            link1: (
              <a
                href="https://dosya.dev/developer/api"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {t('integrations-rest-api.action.apiDocumentation')}
              </a>
            ),
          })}
        </p>
      </Step>
    </IntegrationLayout>
  );
}
