import { useMemo } from 'react';
import { renderMarkdown } from '@/lib/md-render';

/**
 * The rendered side of the split. The HTML is sanitized by renderMarkdown
 * before it gets here (see lib/md-render.ts for the policy): every link left
 * in it is http(s) or mailto and opens in a new tab with no opener or
 * referrer, so a click never navigates away from unsaved text.
 */
export function MarkdownPreview({
  text,
  ref,
  label,
}: {
  text: string;
  ref?: React.Ref<HTMLDivElement>;
  label: string;
}) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div
      ref={ref}
      data-testid="md-preview"
      aria-label={label}
      role="document"
      className="h-full min-h-0 overflow-auto px-7 py-6"
    >
      {/* Sanitized in renderMarkdown: no scripts, handlers, styles or classes. */}
      <div className="md-preview mx-auto max-w-[720px]" dir="auto" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
