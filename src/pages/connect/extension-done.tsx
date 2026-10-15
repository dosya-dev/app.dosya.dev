// apps/web/src/pages/connect/extension-done.tsx
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { PublicNav } from '@/components/public-nav';

/**
 * /connect/extension/done - the fallback callback for browsers without the
 * identity API. The extension's content script (injected on this URL only)
 * reads the code and state from the data attributes below; the person just
 * sees "you can close this tab".
 */
export default function ConnectExtensionDonePage() {
  const [params] = useSearchParams();
  const code = params.get('code') ?? '';
  const state = params.get('state') ?? '';
  return (
    <div className="min-h-screen bg-background">
      <PublicNav />
      <main className="mx-auto max-w-md px-4 py-16">
        <Card>
          <CardContent className="space-y-2 p-6">
            <h1 className="text-xl font-semibold">Save to dosya is connected</h1>
            <p className="text-sm text-muted-foreground">You can close this tab.</p>
            <div id="dosya-extension-callback" data-code={code} data-state={state} hidden />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
