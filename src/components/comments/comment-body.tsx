import type { CommentMention } from './types';
import { splitMentions } from './format';

// Plain text segments only (never HTML), with @mentions highlighted.
export function CommentBody({ body, mentions }: { body: string; mentions: CommentMention[] }) {
  return (
    <>
      {splitMentions(body, mentions).map((s, i) =>
        s.mention
          ? <span key={i} data-mention className="font-medium text-primary">{s.text}</span>
          : <span key={i}>{s.text}</span>,
      )}
    </>
  );
}
