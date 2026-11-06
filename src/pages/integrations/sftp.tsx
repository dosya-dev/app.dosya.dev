import { IntegrationLayout, ApiKeyCallout, Step } from '@/components/integrations/integration-layout';
import { CodeBlock } from '@/components/integrations/code-block';
import { useIntegrationCtx } from '@/hooks/use-integration-ctx';
import { usePermissions } from '@/hooks/use-permissions';
import { Lock } from 'lucide-react';
import { getIntegration, SFTP_HOST, SFTP_PORT, sftpConnect, sftpConfig } from '@/lib/integrations';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';

const meta = getIntegration('sftp')!;

export default function SftpSetup() {
  const t = useT();
  const ctx = useIntegrationCtx();
  // The door itself is per role (access_sftp); the key made below is refused at
  // it. Saying so here beats a setup walkthrough that ends in a refused login
  // from an sftp prompt. Only a RESOLVED map says no - the hook fails open.
  const { can, isResolved } = usePermissions();
  const noAccess = isResolved && !can('access_sftp');
  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      {noAccess && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <Lock className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="text-sm">
            <p className="font-medium">{t('integrations-sftp.label.yourRoleCanRsquoTUseSftp')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('common.description.anyCredentialsYouSetUpBelowWillBeRefusedForThis')}
            </p>
          </div>
        </div>
      )}
      <ApiKeyCallout />
      <Step n={1} title={t('integrations-sftp.tooltip.connectFromTheTerminal')}>
        <p>
          {richText(t('integrations-sftp.description.usernameIsYourAccountEmailEmphasis1AndThePasswordPromptTakes'), {
            emphasis1: <code>{ctx.email}</code>,
            emphasis2: <code>dos_…</code>,
          })}
        </p>
        <CodeBlock code={sftpConnect(ctx)} lang="bash" />
      </Step>
      <Step n={2} title={t('integrations-sftp.tooltip.guiClientsFilezillaWinscpCyberduck')}>
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
      <Step n={3} title={t('integrations-sftp.tooltip.saveAShortcutSshConfig')}>
        <p>
          {richText(t('integrations-sftp.description.addThisSoYouCanJustRunEmphasis1'), { emphasis1: <code>sftp dosya</code> })}
        </p>
        <CodeBlock code={sftpConfig(ctx)} lang="text" caption="~/.ssh/config" />
      </Step>
    </IntegrationLayout>
  );
}
