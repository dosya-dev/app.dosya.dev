import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CreditCard, Download, ExternalLink, AlertTriangle, Check,
} from 'lucide-react';

interface BillingData {
  plan: {
    name: string;
    storage_label: string;
    storage_bytes: number;
    price_monthly: number;
    price_yearly: number;
    features: string[];
  };
  
  usage: {
    used_bytes: number;
    used_label: string;
    pct: number;
  };
  subscription: {
    status: string | null;
    current_period_end: number | null;
    cancel_at_period_end: boolean;
    grace_period_end: number | null;
  };
  invoices: {
    id: string;
    period_start: number;
    period_end: number;
    amount: number;
    status: string;
    pdf_url: string | null;
  }[];
  portal_url: string | null;
}

const PLAN_COLORS: Record<string, string> = {
  free: '#6b7280', starter: '#3b82f6', plus: '#8b5cf6', pro: '#f59e0b', business: '#059669',
};

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ ok: boolean } & BillingData>('/api/billing/status')
      .then((d) => { if (d.ok) setData(d as any); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-sm text-muted-foreground">Failed to load billing information.</p>
      </div>
    );
  }

  const plan = data.plan;
  const usage = data.usage;
  const sub = data.subscription;
  const storagePct = usage.pct;
  const storageColor = storagePct > 90 ? '#ef4444' : storagePct > 70 ? '#D97706' : '#22c55e';

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-6">Billing</h1>

      {/* Current plan */}
      <Card className="gap-0 py-0 p-5 mb-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge style={{ background: PLAN_COLORS[plan.name.toLowerCase()] || '#6b7280', color: '#fff' }} className="text-xs">
                {plan.name}
              </Badge>
              {sub.status === 'active' && <Badge variant="outline" className="text-[10px] text-green-600 border-green-200">Active</Badge>}
              {sub.cancel_at_period_end && <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200">Cancelling</Badge>}
            </div>
            <p className="text-2xl font-bold">${plan.price_monthly}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
            {sub.current_period_end && (
              <p className="text-xs text-muted-foreground mt-1">
                {sub.cancel_at_period_end ? 'Cancels' : 'Renews'} {new Date(sub.current_period_end * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            )}
          </div>
          {data.portal_url && (
            <a href={data.portal_url} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                <ExternalLink className="size-3" /> Manage subscription
              </Button>
            </a>
          )}
        </div>

        {/* Storage */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Storage</span>
            <span className="text-xs text-muted-foreground">{usage.used_label} / {plan.storage_label}</span>
          </div>
          <Progress
            value={Math.min(storagePct, 100)}
            className="**:data-[slot=progress-track]:h-2 **:data-[slot=progress-track]:bg-border **:data-[slot=progress-indicator]:bg-(--storage-color)"
            style={{ '--storage-color': storageColor } as React.CSSProperties}
          />
          {storagePct >= 80 && (
            <div className="flex items-center gap-1.5 mt-2 text-xs" style={{ color: storagePct >= 95 ? '#ef4444' : '#D97706' }}>
              <AlertTriangle className="size-3" />
              {storagePct >= 95 ? 'Storage almost full. Upgrade your plan.' : `${Math.round(100 - storagePct)}% remaining`}
            </div>
          )}
        </div>

        {/* Features */}
        {plan.features && plan.features.length > 0 && (
          <div className="pt-3 border-t">
            <p className="text-xs font-medium text-muted-foreground mb-2">Plan includes</p>
            <div className="grid grid-cols-2 gap-1.5">
              {plan.features.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Check className="size-3 text-green-500 shrink-0" /> {f}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Invoices */}
      <Card className="gap-0 py-0 overflow-hidden">
        <div className="px-5 py-3 border-b">
          <h2 className="text-sm font-semibold">Invoices</h2>
        </div>
        {data.invoices.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">No invoices yet</p>
        ) : (
          data.invoices.map((inv) => (
            <div key={inv.id} className="flex items-center gap-3 px-5 py-3 border-b last:border-b-0 hover:bg-muted/50">
              <CreditCard className="size-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  ${(inv.amount / 100).toFixed(2)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(inv.period_start * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {new Date(inv.period_end * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
              <Badge variant={inv.status === 'paid' ? 'secondary' : 'outline'} className="text-[10px]">
                {inv.status}
              </Badge>
              {inv.pdf_url && (
                <a href={inv.pdf_url} target="_blank" rel="noreferrer" className="size-7 rounded flex items-center justify-center hover:bg-muted" title="Download PDF">
                  <Download className="size-3.5 text-muted-foreground" />
                </a>
              )}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
