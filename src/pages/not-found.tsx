import { ErrorLayout } from '@/components/error-layout';
import { useT } from '@/lib/i18n';

export default function NotFoundPage() {
  const t = useT();
  return (
    <ErrorLayout
      code="404"
      title={t('common.tooltip.pageNotFound')}
      message={t('common.description.thePageYouReLookingForDoesnTExistOrMayHaveMoved')}
    />
  );
}
