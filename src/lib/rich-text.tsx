import { Fragment, type ReactNode } from 'react';

/**
 * A translated sentence with React elements in some of its placeholders: a
 * link, a bold name. The sentence stays one catalog message, so each language
 * keeps its own word order. Pass t(key) output (placeholders left unfilled
 * render as `{name}`) and a slot per placeholder to replace.
 */
export function richText(message: string, slots: Record<string, ReactNode>): ReactNode {
  const names = Object.keys(slots);
  if (names.length === 0) return message;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = message.split(new RegExp(`\\{(${escaped.join('|')})\\}`));
  // split() with a capture group alternates text and the captured name.
  return (
    <>
      {parts.map((part, i) => (i % 2 === 0 ? part : <Fragment key={i}>{slots[part]}</Fragment>))}
    </>
  );
}
