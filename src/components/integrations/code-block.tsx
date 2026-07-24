import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { highlightToHtml } from '@/lib/text-highlight';

// Colorful, read-only code block. Renders the snippet with shiki
// (github-dark-default), falling back to plain text while the highlighter
// and grammar load. The surface is intentionally dark in every app theme so
// the syntax colors stay legible and consistent.
export function CodeBlock({ code, lang = 'bash', caption }: { code: string; lang?: string; caption?: string }) {
  const [copied, setCopied] = useState(false);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    highlightToHtml(code, lang)
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
    <div className="relative overflow-hidden rounded-lg border border-[#30363d] bg-[#0d1117]">
      {caption && (
        <div className="border-b border-[#30363d] px-3 py-1.5 text-[11px] font-medium text-gray-400">
          {caption}
        </div>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label="Copy to clipboard"
        className="absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
      >
        {copied ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5" />}
      </button>
      {html ? (
        <div
          className="overflow-x-auto text-[13px] leading-relaxed [&_code]:text-[13px]! [&_pre]:m-0! [&_pre]:bg-transparent! [&_pre]:p-3 [&_pre]:pr-10"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto p-3 pr-10 text-[13px] leading-relaxed text-gray-300">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
