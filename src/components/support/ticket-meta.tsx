import { Badge } from '@/components/ui/badge';
import type { TicketCategory } from '@/api/support';
import type { MessageKey } from '@/i18n/keys';
import { t as translate, useT } from '@/lib/i18n';

// Keys, not sentences: the labels are translated when read.
const CATEGORY_KEYS: { value: TicketCategory; labelKey: MessageKey }[] = [
  { value: 'bug', labelKey: 'common.label.bugReport' },
  { value: 'technical', labelKey: 'common.label.technicalIssue' },
  { value: 'billing', labelKey: 'common.label.billing' },
  { value: 'account', labelKey: 'common.label.account' },
  { value: 'feature_request', labelKey: 'common.label.featureRequest' },
  { value: 'other', labelKey: 'common.label.other' },
];

/** The category choices in the current language. Call at render. */
export function categoryOptions(): { value: TicketCategory; label: string }[] {
  return CATEGORY_KEYS.map((o) => ({ value: o.value, label: translate(o.labelKey) }));
}

/** One category's label in the current language, or the raw value for an unknown one. */
export function categoryLabel(category: string): string {
  const hit = CATEGORY_KEYS.find((o) => o.value === category);
  return hit ? translate(hit.labelKey) : category;
}

export function StatusBadge({ status }: { status: string }) {
  const t = useT();
  if (status === 'closed') return <Badge variant="secondary">{t('common.status.closed')}</Badge>;
  if (status === 'answered') {
    return <Badge className="bg-green-600/10 text-green-700 dark:text-green-400 border border-green-600/20">{t('common.status.answered')}</Badge>;
  }
  return <Badge>{t('common.status.open')}</Badge>;
}
