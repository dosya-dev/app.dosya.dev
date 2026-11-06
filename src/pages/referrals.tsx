import { useEffect, useState } from 'react';
import { Gift } from 'lucide-react';
import { CopyCheck } from '@/components/ui/copy-check';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { useT } from '@/lib/i18n';
import { friendStatusLabel, getReferralSummary, type ReferralSummary } from '@/api/referrals';

// TODO(catalog): the catalog wrote the "5 GB" and "50 MB" figures with a plain
// space; the page used a no-break space between the number and the unit.
const nbspUnits = (s: string) => s.replace(/(\d) (GB|MB)\b/g, '$1\u00a0$2');

export default function ReferralsPage() {
  const t = useT();
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
        <p className="text-sm text-muted-foreground">{t('referrals.error.failedToLoadYourReferralsPleaseTryAgain')}</p>
      </div>
    );
  }

  const joined = Math.min(data.credited_count, data.max_rewards);
  const pct = Math.round((joined / data.max_rewards) * 100);
  const atCap = data.credited_count >= data.max_rewards;
  const inviteText = t('referrals.description.inviteAFriendAndEarn5GbMaxfriendsTotalgb', { maxFriends: data.max_rewards, totalGb: data.max_rewards * 5 });

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Gift className="size-5" /> {t('common.heading.referFriends')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {nbspUnits(inviteText)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {nbspUnits(t('referrals.description.aFriendCountsOnceTheirAccountIsAWeekOldAnd'))}
        </p>
      </div>

      <Card className="gap-0 py-0 p-5 space-y-4">
        <div>
          <p className="text-sm font-medium mb-2">{t('common.label.yourInviteLink')}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border bg-muted/50 px-3 py-2 text-sm">{data.link}</code>
            <Button variant="outline" size="sm" onClick={copy}>
              <CopyCheck copied={copied} className="size-4" />
              {copied ? t('common.action.copied') : t('common.copy')}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('referrals.label.joinedOfDatamaxRewardsFriendsCounted', { joined, dataMax_rewards: data.max_rewards })}</span>
            <span className="font-medium">{t('referrals.label.databonusLabelEarned', { dataBonus_label: data.bonus_label })}</span>
          </div>
          <Progress value={pct} />
          {atCap && (
            <p className="text-xs text-muted-foreground">
              {t('referrals.description.youVeEarnedTheMaximumBonusThanksForSpreadingTheWord')}
            </p>
          )}
        </div>
      </Card>

      <Card className="gap-0 py-0 overflow-hidden">
        <div className="px-5 py-3 border-b">
          <p className="text-sm font-medium">{t('referrals.label.invitedFriends')}</p>
        </div>
        {data.friends.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            {t('referrals.description.noInvitesYetShareYourLinkToGetStarted')}
          </p>
        ) : (
          data.friends.map((f, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-3 border-b last:border-b-0">
              <span className="text-sm">{f.email_masked}</span>
              <Badge variant={f.status === 'credited' ? 'default' : 'secondary'}>
                {friendStatusLabel(f.status)}
              </Badge>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
