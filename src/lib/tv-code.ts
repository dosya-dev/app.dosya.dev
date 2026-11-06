/**
 * The code a dosya TV app shows while it waits to be signed in
 * (docs/TV-API-CONTRACT.md §1). Eight characters from an alphabet without
 * vowels or look-alikes, shown as XXXX-XXXX, compared case-insensitively
 * with the dash optional.
 */
const ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';
const VALID = new RegExp(`^[${ALPHABET}]{8}$`);

/**
 * The display form ("KDTR-9WMX") of whatever was typed or carried in the
 * link, or null when it cannot be a TV code. Spaces, dashes and case are
 * forgiven; a character outside the alphabet (an O, a 0, a vowel) is not,
 * so a typo fails here instead of spending a rate-limited lookup.
 */
export function normalizeTvCode(input: string): string | null {
  // \u2010-\u2015: the hyphens and dashes a phone keyboard substitutes for "-".
  const bare = input.replace(/[\s\-\u2010-\u2015]+/g, '').toUpperCase();
  if (!VALID.test(bare)) return null;
  return `${bare.slice(0, 4)}-${bare.slice(4)}`;
}
