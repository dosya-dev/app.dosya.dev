export const REDEMPTION_CLAIM_KEY = 'dosya_redemption_claim';
export const REDEMPTION_PROVIDER_KEY = 'dosya_redemption_provider';

export type RedemptionProvider = 'gumroad' | 'voucher';

const CLAIM_RE = /^[A-Za-z0-9_-]{32,80}$/;
const REDEMPTION_CONTINUATION = '/redeem' as const;

function validClaim(token: string | null | undefined): token is string {
  return typeof token === 'string' && CLAIM_RE.test(token);
}

export function rememberRedemptionClaim(token: string): string | null {
  if (!validClaim(token)) return null;
  try {
    sessionStorage.setItem(REDEMPTION_CLAIM_KEY, token);
  } catch {
    return null;
  }
  return token;
}

export function readRedemptionClaim(): string | null {
  try {
    const token = sessionStorage.getItem(REDEMPTION_CLAIM_KEY);
    return validClaim(token) ? token : null;
  } catch {
    return null;
  }
}

// The provider is not a secret; it only keeps the page's copy correct when a
// held claim is picked up again after a sign-in round trip or a reload.
export function rememberRedemptionProvider(provider: RedemptionProvider): void {
  try {
    sessionStorage.setItem(REDEMPTION_PROVIDER_KEY, provider);
  } catch {
    // Restricted browsing contexts can disable sessionStorage; the copy just falls back.
  }
}

export function readRedemptionProvider(): RedemptionProvider | null {
  try {
    const provider = sessionStorage.getItem(REDEMPTION_PROVIDER_KEY);
    return provider === 'gumroad' || provider === 'voucher' ? provider : null;
  } catch {
    return null;
  }
}

export function clearRedemptionClaim(): void {
  try {
    sessionStorage.removeItem(REDEMPTION_CLAIM_KEY);
    sessionStorage.removeItem(REDEMPTION_PROVIDER_KEY);
  } catch {
    // Restricted browsing contexts can disable sessionStorage; clearing is best-effort.
  }
}

export function pendingPostAuthPath(): '/redeem' | null {
  return readRedemptionClaim() ? REDEMPTION_CONTINUATION : null;
}
