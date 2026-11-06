import type { T } from '@/i18n/translator';
import type { MessageKey } from '@/i18n/keys';

/**
 * Renders a message whose ICU select is keyed on the same placeholder it then
 * prints, for example `{version, select, true { (plug-in {version})} other {}}`.
 *
 * TODO(catalog): a select can only match the literal option "true", so the
 * value cannot reach the inner placeholder. The select is switched with "true"
 * (or "" for absent) and the inner "true" is turned back into `{carrier}`, a
 * slot the caller fills with richText. Only the template text is touched, never
 * a value: values are passed to richText as slots, not through t().
 */
export function carriedMessage(
  t: T,
  key: MessageKey,
  carrier: string,
  present: boolean,
  values: Record<string, string | number> = {},
): string {
  const message = t(key, { ...values, [carrier]: present ? 'true' : '' });
  return present ? message.split('true').join(`{${carrier}}`) : message;
}

/** Collapses the doubled spaces a catalog message leaves around an empty optional part. */
export const tidySpaces = (message: string): string => message.replace(/ {2,}/g, ' ');
