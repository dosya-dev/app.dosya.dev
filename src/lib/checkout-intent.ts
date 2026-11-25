/**
 * A purchase someone started on dosya.dev before they had an account.
 *
 * dosya.dev/promo sends a signed-out visitor to
 * `/sign-up?plan=tb4&billing=yearly&promo=SYNOLOGY30`. Sign-up used to ignore
 * all three, so the new account landed on the free plan with the code gone.
 * Now sign-up turns them into a Billing path (remembered as the post-auth
 * path, so it survives the OAuth round trip and the tour), and Billing opens
 * the plan chooser on that plan with the code already applied.
 *
 * Everything is validated by shape only; the API still decides whether the
 * plan exists and whether the code is valid for it.
 */

const PLAN_RE = /^[a-z0-9]{2,16}$/;
const CODE_RE = /^[A-Za-z0-9_-]{2,40}$/;

export type BillingIntent = {
  planId?: string;
  interval?: 'month' | 'year';
  promo?: string;
};

/** The Billing path for the plan/billing/promo a sign-up link carries, or null when it carries none. */
export function checkoutIntentPath(query: URLSearchParams): string | null {
  const out = new URLSearchParams();
  const plan = query.get('plan');
  const billing = query.get('billing');
  const promo = query.get('promo');
  if (plan && PLAN_RE.test(plan) && plan !== 'free') out.set('plan', plan);
  if (billing === 'yearly' || billing === 'monthly') out.set('interval', billing === 'yearly' ? 'year' : 'month');
  if (promo && CODE_RE.test(promo)) out.set('promo', promo.toUpperCase());
  if (!out.has('plan') && !out.has('promo')) return null;
  return `/billing?upgrade=1&${out.toString()}`;
}

/** What Billing should preselect, read from its own query string. */
export function readBillingIntent(search: string): BillingIntent {
  const q = new URLSearchParams(search);
  const plan = q.get('plan');
  const interval = q.get('interval');
  const promo = q.get('promo');
  return {
    ...(plan && PLAN_RE.test(plan) && plan !== 'free' ? { planId: plan } : {}),
    ...(interval === 'month' || interval === 'year' ? { interval } : {}),
    ...(promo && CODE_RE.test(promo) ? { promo: promo.toUpperCase() } : {}),
  };
}
