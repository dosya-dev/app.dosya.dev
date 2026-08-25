import { describe, it, expect } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';

describe('parseInline', () => {
  it('passes plain text through untouched', () => {
    expect(parseInline('just words')).toEqual([{ kind: 'text', text: 'just words' }]);
  });

  it('resolves bold, italic, code and links in one line', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.test)')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'italic', text: 'c' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'd' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'e', url: 'https://x.test' },
    ]);
  });

  it('keeps asterisks inside code spans literal', () => {
    expect(parseInline('`*ptr` rest')).toEqual([
      { kind: 'code', text: '*ptr' },
      { kind: 'text', text: ' rest' },
    ]);
  });

  it('leaves an unclosed marker as literal text', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ kind: 'text', text: '2 * 3 = 6' }]);
  });
});

describe('parseMarkdown', () => {
  it('splits headings, paragraphs and rules', () => {
    const blocks = parseMarkdown('# Title\n\nSome text\nsame paragraph\n\n---\n\nNext');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'hr', 'paragraph']);
  });

  it('keeps code fences verbatim and survives an unclosed fence', () => {
    expect(parseMarkdown('```ts\nconst a = b ** c;\n```')).toEqual([
      { kind: 'code', text: 'const a = b ** c;', lang: 'ts' },
    ]);
    expect(parseMarkdown('```\nline1\nline2')).toEqual([
      { kind: 'code', text: 'line1\nline2', lang: null },
    ]);
  });

  it('collects list items, ordered and not', () => {
    const blocks = parseMarkdown('- one\n- two\n\n1. first\n2. second');
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false });
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: true });
  });

  it('joins quote lines into one block', () => {
    expect(parseMarkdown('> a\n> b')).toEqual([
      { kind: 'quote', inline: [{ kind: 'text', text: 'a b' }] },
    ]);
  });
});
