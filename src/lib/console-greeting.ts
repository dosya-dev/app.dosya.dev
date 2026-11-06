// Logs on every load rather than trying to detect an opened DevTools panel -
// that detection is unreliable across browsers and reads as fingerprinting.
// A message that is simply always there, invisible until the console is
// opened, gets the same result honestly.

import { t } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';

const BUG_BOUNTY_URL = 'https://dosya.dev/bug-bounty';

interface GreetingLine {
  /** A catalog key, or a literal (the brand name and the URL) when `literal` is set. */
  text: MessageKey | string;
  literal?: boolean;
  style?: string;
}

const GREETING_LINES: GreetingLine[] = [
  { text: 'dosya.dev', literal: true, style: 'color:#5fb0ff;font-weight:800;font-size:20px;' },
  { text: '' },
  { text: 'common.description.pokingAroundInHereWeLikeThat' },
  { text: '' },
  { text: 'common.description.ifYouSpotSomethingThatShouldnTBePossible' },
  { text: 'common.description.anAccessControlGapABypassAnythingWeD' },
  { text: 'common.description.ratherHearItFromYouFirst' },
  { text: '' },
  { text: 'common.label.ourBugBountyProgram' },
  { text: BUG_BOUNTY_URL, literal: true, style: 'color:#5fb0ff;font-weight:700;' },
  { text: '' },
  { text: 'common.description.scopeRulesOfEngagementAndSafeHarborAreAllThere', style: 'color:#7d8590;' },
];

export function logConsoleGreeting(): void {
  for (const line of GREETING_LINES) {
    const text = line.literal || line.text === '' ? line.text : t(line.text as MessageKey);
    if (line.style) console.log(`%c${text}`, line.style);
    else console.log(text);
  }
}
