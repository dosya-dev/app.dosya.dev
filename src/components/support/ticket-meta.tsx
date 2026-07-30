import { Badge } from '@/components/ui/badge';
import type { TicketCategory } from '@/api/support';

export const CATEGORY_OPTIONS: { value: TicketCategory; label: string }[] = [
  { value: 'technical', label: 'Technical issue' },
  { value: 'billing', label: 'Billing' },
  { value: 'account', label: 'Account' },
  { value: 'feature_request', label: 'Feature request' },
  { value: 'other', label: 'Other' },
];

export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((o) => [o.value, o.label]),
);

export function StatusBadge({ status }: { status: string }) {
  if (status === 'closed') return <Badge variant="secondary">Closed</Badge>;
  if (status === 'answered') {
    return <Badge className="bg-green-600/10 text-green-700 dark:text-green-400 border border-green-600/20">Answered</Badge>;
  }
  return <Badge>Open</Badge>;
}
