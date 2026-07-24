import { Monitor, Apple, Terminal } from 'lucide-react';
import { IntegrationLayout, Step } from '@/components/integrations/integration-layout';
import { CodeBlock } from '@/components/integrations/code-block';
import { API_BASE } from '@/api/client';
import { getIntegration, desktopDownload, cliInstall } from '@/lib/integrations';

const meta = getIntegration('desktop')!;

const DOWNLOADS: { platform: 'windows' | 'mac' | 'linux'; label: string; icon: typeof Monitor }[] = [
  { platform: 'windows', label: 'Windows', icon: Monitor },
  { platform: 'mac', label: 'macOS', icon: Apple },
  { platform: 'linux', label: 'Linux', icon: Terminal },
];

export default function DesktopSetup() {
  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      <Step n={1} title="Download the desktop app">
        <div className="flex flex-wrap gap-2">
          {DOWNLOADS.map((d) => (
            <a
              key={d.platform}
              href={desktopDownload(API_BASE, d.platform)}
              className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
            >
              <d.icon className="size-4" /> {d.label}
            </a>
          ))}
        </div>
      </Step>
      <Step n={2} title="Or install the CLI">
        <p>One line on macOS and Linux:</p>
        <CodeBlock code={cliInstall} />
      </Step>
    </IntegrationLayout>
  );
}
