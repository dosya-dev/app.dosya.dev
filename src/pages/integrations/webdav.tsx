import { IntegrationLayout, ApiKeyCallout, Step } from '@/components/integrations/integration-layout';
import { CodeBlock } from '@/components/integrations/code-block';
import { useIntegrationCtx } from '@/hooks/use-integration-ctx';
import { usePermissions } from '@/hooks/use-permissions';
import { Lock } from 'lucide-react';
import { getIntegration, webdavUrl, webdavWindowsMount, webdavLinuxMount } from '@/lib/integrations';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';

const meta = getIntegration('webdav')!;

export default function WebdavSetup() {
  const t = useT();
  const ctx = useIntegrationCtx();
  // The door itself is per role (access_webdav); the key made below is refused at
  // it. Saying so here beats a setup walkthrough that ends in a 403 from a
  // mount dialog. Only a RESOLVED map says no - the hook fails open.
  const { can, isResolved } = usePermissions();
  const noAccess = isResolved && !can('access_webdav');
  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      {noAccess && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <Lock className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="text-sm">
            <p className="font-medium">{t('integrations-webdav.label.yourRoleCanRsquoTUseWebdav')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('common.description.anyCredentialsYouSetUpBelowWillBeRefusedForThis')}
            </p>
          </div>
        </div>
      )}
      <ApiKeyCallout />
      <Step n={1} title={t('integrations-webdav.tooltip.endpointCredentials')}>
        <p>{t('integrations-webdav.description.connectAnyWebdavClientToThisUrl')}</p>
        <CodeBlock code={webdavUrl(ctx)} lang="text" />
        <p>
          {richText(t('integrations-webdav.description.signInWithEmphasis1UsernameIsYourAccountEmailEmphasis2'), {
            emphasis1: <strong>HTTP Basic auth</strong>,
            emphasis2: <code>{ctx.email}</code>,
            emphasis3: <code>dos_…</code>,
          })}
        </p>
        <p>
          {t('integrations-webdav.description.yourWorkspaceAppearsTwiceOnPurposeFinderAndExplorerNameThe')}
        </p>
        <p>
          {t('integrations-webdav.description.becauseThatLastPartIsOnlyALabelRenamingThisWorkspace')}
        </p>
      </Step>
      <Step n={2} title={t('integrations-webdav.tooltip.macosFinder')}>
        <p>
          {richText(t('integrations-webdav.description.finderGoEmphasis1PasteTheUrlThenEnterYour'), {
            emphasis1: <em>{t('integrations-webdav.label.connectToServer')}</em>,
          })}
        </p>
      </Step>
      <Step n={3} title={t('integrations-webdav.tooltip.windows')}>
        <p>{t('integrations-webdav.description.mapANetworkDriveFromAnElevatedPrompt')}</p>
        <CodeBlock code={webdavWindowsMount(ctx)} lang="powershell" />
      </Step>
      <Step n={4} title={t('integrations-webdav.tooltip.linuxDavfs2')}>
        <CodeBlock code={webdavLinuxMount(ctx)} lang="bash" />
      </Step>
      <Step n={5} title={t('integrations-webdav.tooltip.limitingAKeyToOneFolder')}>
        <p>
          {richText(t('integrations-webdav.description.aKeyDoesNotHaveToReachYourWholeWorkspaceWhen'), {
            link1: <a href="/profile">{t('integrations-webdav.action.profilePage')}</a>,
          })}
        </p>
        <p>
          {t('integrations-webdav.description.aFolderAnchoredKeyWorksOverWebdavAndTheS3GatewayIt')}
        </p>
        <p>
          {richText(t('integrations-webdav.description.twoThingsWorthKnowingAnAnchoredMountDoesNotShowThe'), {
            emphasis1: <code>{t('common.label.documents')}</code>,
            emphasis2: <code>{t('common.label.videos')}</code>,
            emphasis3: <code>{t('common.label.images')}</code>,
            emphasis4: <code>{t('common.label.shared')}</code>,
            emphasis5: <code>{t('common.label.deleted')}</code>,
          })}
        </p>
      </Step>
      <Step n={6} title={t('integrations-webdav.tooltip.limitingAKeyToCertainProtocols')}>
        <p>
          {t('integrations-webdav.description.theSameCreationFormLetsYouTickWhichProtocolsAKey')}
        </p>
        <p>
          {t('integrations-webdav.description.thisIsPerKeyNotPerPersonIfYouWantA')}
        </p>
      </Step>
    </IntegrationLayout>
  );
}
