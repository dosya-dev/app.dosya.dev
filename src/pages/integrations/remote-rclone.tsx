import { IntegrationLayout } from '@/components/integrations/integration-layout';
import { RemoteImportPanel } from '@/components/rclone-import/remote-import-panel';
import { getIntegration } from '@/lib/integrations';
import { useT } from '@/lib/i18n';

const meta = getIntegration('remote-rclone')!;

/** /integrations/remote-rclone - import from 40+ clouds through rclone on our server. */
export default function RemoteRclonePage() {
  // Subscribes this page to locale changes, so the header re-renders when the
  // language switches while the page is open (meta's getters read t() lazily).
  useT();
  return (
    <IntegrationLayout icon={meta.icon} iconSrc={meta.iconSrc} badge={meta.badge} title={meta.title} description={meta.description} wide>
      <RemoteImportPanel />
    </IntegrationLayout>
  );
}
