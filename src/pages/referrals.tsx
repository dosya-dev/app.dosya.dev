import { useEffect, useState } from 'react';
import { Gift, Copy, Check } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { getReferralSummary, type ReferralSummary } from '@/api/referrals';

export default function ReferralsPage() {
  const [data, setData] = useState<ReferralSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getReferralSummary().then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const copy = async () => {
    if (!data) return;
    await navigator.clipboard.writeText(data.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-sm text-muted-foreground">Failed to load your referrals. Please try again.</p>
      </div>
    );
  }

  const joined = Math.min(data.credited_count, data.max_rewards);
  const pct = Math.round((joined / data.max_rewards) * 100);
  const atCap = data.credited_count >= data.max_rewards;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Gift className="size-5" /> Refer friends
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Invite a friend and earn 5&nbsp;GB when they join — up to {data.max_rewards} friends ({data.max_rewards * 5}&nbsp;GB total).
        </p>
      </div>

      <Card className="gap-0 py-0 p-5 space-y-4">
        <div>
          <p className="text-sm font-medium mb-2">Your invite link</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border bg-muted/50 px-3 py-2 text-sm">{data.link}</code>
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{joined} of {data.max_rewards} friends joined</span>
            <span className="font-medium">+{data.bonus_label} earned</span>
          </div>
          <Progress value={pct} />
          {atCap && (
            <p className="text-xs text-muted-foreground">
              You've earned the maximum bonus — thanks for spreading the word!
            </p>
          )}
        </div>
      </Card>

      <Card className="gap-0 py-0 overflow-hidden">
        <div className="px-5 py-3 border-b">
          <p className="text-sm font-medium">Invited friends</p>
        </div>
        {data.friends.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            No invites yet — share your link to get started.
          </p>
        ) : (
          data.friends.map((f, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-3 border-b last:border-b-0">
              <span className="text-sm">{f.email_masked}</span>
              <Badge variant={f.status === 'credited' ? 'default' : 'secondary'}>
                {f.status === 'credited' ? 'Joined' : 'Pending'}
              </Badge>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
