import { createExternalTranslator } from '@/i18n/match';
import { EXTERNAL_KEYS } from '@/i18n/external-keys';
import en from '@/i18n/messages/en.json';
import { currentLocale, currentMessages } from '@/lib/i18n';

/**
 * Text the app shows but does not author: the shared validation policy's
 * messages (lib/validation-policy.generated.ts) and the e2ee client's errors.
 * It is English when it reaches the screen, so it is translated where it is
 * displayed: the strict matcher in i18n/match.ts translates only text that
 * equals a catalog message (EXTERNAL_KEYS) with its arguments captured
 * exactly; anything else comes back as it was given. English stays English.
 *
 * Call it at render, or at the moment a toast is raised, so it follows the
 * language. Never for user content or server text on its own: a file named
 * like a catalog message would be "translated".
 */
export type ExternalHint = 'heading' | 'button' | 'toast' | 'error';

const HINTS = { heading: 'heading', button: 'action', toast: 'status', error: 'status' } as const;

const english = en as Record<string, string>;
const external = createExternalTranslator(english, EXTERNAL_KEYS);

export function translateExternal(text: string, hint?: ExternalHint): string {
  return external(currentLocale(), currentMessages(), text, hint ? HINTS[hint] : undefined);
}
