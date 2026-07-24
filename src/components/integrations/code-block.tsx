import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { highlightToHtmlThemed } from '@/lib/text-highlight';

// Colorful, read-only code block that follows the app theme. The surface uses
// theme tokens (so it blends into any of the 8 themes) and the syntax colors
// come from shiki's dual-theme output, switched light/dark by the `.dark`
// ancestor via the `.cb-shiki` rules in index.css. Plain text shows first,
// then swaps in once the highlighter and grammar load.
export function CodeBlock({ code, lang = 'bash', caption }: { code: string; lang?: string; caption?: string }) {
  const [copied, setCopied] = useState(false);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    highlightToHtmlThemed(code, lang)
      .then((h) => { if (!cancelled) setHtml(h); })
      .catch(() => { /* keep plain fallback */ });
    return () => { cancelled = true; };
  }, [code, lang]);

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
    <div className="relative overflow-hidden rounded-lg border bg-muted/40">
      {caption && (
        <div className="border-b bg-muted/50 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
          {caption}
        </div>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label="Copy to clipboard"
        className="absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
      </button>
      {html ? (
        <div
          className="cb-shiki overflow-x-auto text-[13px] leading-relaxed [&_code]:text-[13px]! [&_pre]:m-0! [&_pre]:bg-transparent! [&_pre]:p-3 [&_pre]:pr-10"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto p-3 pr-10 text-[13px] leading-relaxed text-foreground/80">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
