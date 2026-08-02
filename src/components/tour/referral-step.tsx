import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/api/client';

interface ReferralResponse {
  ok: boolean;
  code: string;
  link: string;
  credited_count: number;
  max_rewards: number;
  bonus_label: string;
}

/**
 * The referral link on the tour's last page.
 *
 * No new backend: GET /api/referrals calls ensureReferralCode, so the code and
 * link exist the first time anyone asks for them.
 *
 * A failure renders nothing at all. Losing the link is a small loss - blocking
 * the end of onboarding behind a referral outage is not acceptable.
 */
export function ReferralStep() {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<ReferralResponse>('/api/referrals');
        if (!cancelled && res.ok) setLink(res.link);
      } catch { /* the page stands without it */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!link) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked; the input is selectable anyway */ }
  };

  return (
    <div>
      <p className="text-sm font-medium mb-1">Your invite link</p>
      <p className="text-xs text-muted-foreground mb-3">
        Every friend who joins adds 5 GB to your account, up to 25 GB.
      </p>
      <div className="flex items-center gap-2">
        <input
          data-testid="referral-link"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 h-9 px-3 rounded-lg border bg-muted/40 text-xs font-mono min-w-0"
        />
        <Button
          variant="outline"
          size="sm"
          data-testid="referral-copy"
          onClick={() => { void copy(); }}
          className="h-9 gap-1.5 shrink-0"
        >
          {copied ? <><Check className="size-3.5" /> Copied</> : <><Copy className="size-3.5" /> Copy</>}
        </Button>
      </div>
    </div>
  );
}
