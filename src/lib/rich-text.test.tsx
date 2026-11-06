import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { richText } from './rich-text';

describe('richText', () => {
  it('puts the slots where the message has them, in any order', () => {
    const html = renderToStaticMarkup(<>{richText('Read {b} then {a}.', { a: <a href="/a">A</a>, b: <b>B</b> })}</>);
    expect(html).toBe('Read <b>B</b> then <a href="/a">A</a>.');
  });
  it('leaves other braces and html literal', () => {
    const html = renderToStaticMarkup(<>{richText('<i>{x}</i> {y}', { x: 'ok' })}</>);
    expect(html).toBe('&lt;i&gt;ok&lt;/i&gt; {y}');
  });
});
