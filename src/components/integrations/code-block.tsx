import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CodeBlock({ code, caption }: { code: string; caption?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — leave the button unchanged */
    }
  };

  return (
    <div className="relative rounded-lg border bg-muted/40">
      {caption && (
        <div className="border-b px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
          {caption}
        </div>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label="Copy to clipboard"
        className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
      </button>
      <pre className="overflow-x-auto p-3 pr-10 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
