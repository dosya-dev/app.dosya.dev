/**
 * Client-side password strength feedback for sign-up and password reset.
 *
 * Deliberately small: this is guidance shown while typing, not an authorization
 * decision. The server still enforces its own rules, and nothing here blocks a
 * submit - the submit gate calls validatePassword() from the shared policy, and
 * a user who insists on a weak-but-valid password after being warned is making
 * an informed choice.
 */
import { LIMITS } from '@/lib/validation-policy.generated';
import { t } from '@/lib/i18n';

/**
 * Re-exported from the shared validation policy rather than declared here: the
 * meter said "Use at least 8 characters" from its own constant while the submit
 * gate enforced the server's, and two numbers that must agree should not be two
 * numbers. See lib/validation-policy.generated.ts.
 */
export const MIN_PASSWORD_LENGTH = LIMITS.PASSWORD_MIN;

export type StrengthLabel = 'Weak' | 'Fair' | 'Good' | 'Strong';

// Labels are translated when scorePassword runs (never at import time), so the
// result follows the language chosen at the moment of the call.
const LABEL_TEXT: Record<StrengthLabel, () => string> = {
  Weak: () => t('common.label.weak'),
  Fair: () => t('common.label.fair'),
  Good: () => t('common.label.good'),
  Strong: () => t('common.label.strong'),
};

export interface PasswordStrength {
  /** 0..4, for the meter. 0 means "too short to score". */
  score: number;
  /** Translated for the current language. */
  label: string;
  /** Non-empty when there is something specific worth saying. */
  warning: string;
  /** Meets the minimum the submit handler enforces. */
  acceptable: boolean;
}

/**
 * Passwords common enough that composition rules are irrelevant - a
 * capital and a digit do not save "Password1". Compared case-insensitively
 * against the password with trailing digits stripped, which is how these
 * actually show up.
 */
const COMMON = new Set([
  'password', 'passw0rd', 'letmein', 'welcome', 'monkey', 'dragon',
  'qwerty', 'qwertyui', 'qwertyuiop', 'asdfgh', 'asdfghjk', 'zxcvbn', 'zxcvbnm',
  'iloveyou', 'admin', 'login', 'abc123', 'football', 'baseball',
  'sunshine', 'princess', 'superman', 'trustno', 'starwars', 'whatever',
  'freedom', 'shadow', 'master', 'hello', 'charlie', 'donald',
]);

/** True when the string is one character repeated (aaaaaaaa). */
function isSingleCharRun(pw: string): boolean {
  return pw.length > 0 && [...pw].every((c) => c === pw[0]);
}

/**
 * True when the string is a straight ascending or descending run of adjacent
 * code points at least `min` long (abcdefgh, 87654321).
 */
function hasSequentialRun(pw: string, min = 6): boolean {
  let asc = 1;
  let desc = 1;
  for (let i = 1; i < pw.length; i++) {
    const delta = pw.charCodeAt(i) - pw.charCodeAt(i - 1);
    asc = delta === 1 ? asc + 1 : 1;
    desc = delta === -1 ? desc + 1 : 1;
    if (asc >= min || desc >= min) return true;
  }
  return false;
}

const LABELS: StrengthLabel[] = ['Weak', 'Weak', 'Fair', 'Good', 'Strong'];

export function scorePassword(pw: string): PasswordStrength {
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return {
      score: 0,
      label: LABEL_TEXT.Weak(),
      warning: pw.length === 0 ? '' : t('common.description.useAtLeastMinLockPasswordLengthCharacters', { minLockPasswordLength: MIN_PASSWORD_LENGTH }),
      acceptable: false,
    };
  }

  const classes =
    Number(/[a-z]/.test(pw)) +
    Number(/[A-Z]/.test(pw)) +
    Number(/[0-9]/.test(pw)) +
    Number(/[^A-Za-z0-9]/.test(pw));

  // Length carries most of the weight - it is the only property that reliably
  // buys entropy, whereas character classes are easily satisfied by "Aa1!".
  let score = 1;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (classes >= 3) score++;
  if (classes >= 2 && pw.length >= 10) score++;

  const normalized = pw.toLowerCase().replace(/[0-9!@#$%^&*._-]+$/, '');
  let warning = '';
  if (COMMON.has(normalized) || COMMON.has(pw.toLowerCase())) {
    warning = t('common.description.thisIsOneOfTheMostCommonlyUsedPasswords');
    score = 0;
  } else if (isSingleCharRun(pw)) {
    warning = t('common.description.aSingleRepeatedCharacterIsTrivialToGuess');
    score = 0;
  } else if (hasSequentialRun(pw)) {
    warning = t('common.description.sequencesLikeAbcdefOr123456AreTrivialToGuess');
    score = 0;
  } else if (/^\d+$/.test(pw)) {
    warning = t('common.description.digitsOnlyAddLettersOrSymbols');
    score = Math.min(score, 1);
  } else if (classes === 1) {
    warning = t('common.description.mixInUpperCaseDigitsOrSymbols');
    score = Math.min(score, 1);
  }

  return {
    score: Math.max(0, Math.min(4, score)),
    label: LABEL_TEXT[LABELS[Math.max(0, Math.min(4, score))]](),
    warning,
    acceptable: true,
  };
}
