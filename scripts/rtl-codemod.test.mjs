import { describe, expect, it } from 'vitest';
import { convertSource, gateFindings } from './rtl-codemod.mjs';

const conv = (s) => convertSource(s).output;

describe('rtl-codemod mapping', () => {
  it.each([
    ['ml-2', 'ms-2'],
    ['mr-2', 'me-2'],
    ['pl-4', 'ps-4'],
    ['pr-4', 'pe-4'],
    ['left-0', 'inset-s-0'],
    ['right-0', 'inset-e-0'],
    ['text-left', 'text-start'],
    ['text-right', 'text-end'],
    ['rounded-l', 'rounded-s'],
    ['rounded-r-lg', 'rounded-e-lg'],
    ['rounded-tl-md', 'rounded-ss-md'],
    ['rounded-tr', 'rounded-se'],
    ['rounded-bl-xl', 'rounded-es-xl'],
    ['rounded-br', 'rounded-ee'],
    ['border-l', 'border-s'],
    ['border-r-2', 'border-e-2'],
    ['border-l-red-500', 'border-s-red-500'],
    ['border-r-border', 'border-e-border'],
    ['scroll-ml-2', 'scroll-ms-2'],
    ['scroll-mr-2', 'scroll-me-2'],
    ['scroll-pl-2', 'scroll-ps-2'],
    ['scroll-pr-2', 'scroll-pe-2'],
    ['float-left', 'float-start'],
    ['float-right', 'float-end'],
    ['ml-auto', 'ms-auto'],
    ['pl-0.5', 'ps-0.5'],
    ['right-1/3', 'inset-e-1/3'],
  ])('%s -> %s', (from, to) => {
    expect(conv(`"${from}"`)).toBe(`"${to}"`);
  });

  it('keeps variant prefixes, negatives, arbitrary values and important', () => {
    expect(conv('"md:hover:ml-2"')).toBe('"md:hover:ms-2"');
    expect(conv('"-mr-1"')).toBe('"-me-1"');
    expect(conv('"pl-[3px]"')).toBe('"ps-[3px]"');
    expect(conv('"!text-left"')).toBe('"!text-start"');
    expect(conv('"dark:md:-left-2"')).toBe('"dark:md:-inset-s-2"');
    expect(conv('"[&>svg]:ml-2"')).toBe('"[&>svg]:ms-2"');
  });

  it('converts inside cn(), cva variants and template literals', () => {
    expect(conv("cn('flex ml-2', open && 'mr-1')")).toBe("cn('flex ms-2', open && 'me-1')");
    expect(conv('cva("base", { variants: { size: { sm: "pl-2 pr-3" } } })')).toBe('cva("base", { variants: { size: { sm: "ps-2 pe-3" } } })');
    expect(conv('const c = `flex ${on ? "ml-2" : ""} text-left`')).toBe('const c = `flex ${on ? "ms-2" : ""} text-start`');
  });

  it('leaves the centering pair alone and reports it', () => {
    const src = '"absolute left-1/2 -translate-x-1/2"';
    const { output, skipped } = convertSource(src);
    expect(output).toBe(src);
    expect(skipped.map((s) => s.token)).toContain('left-1/2');
  });

  it('converts left-1/2 on its own', () => {
    expect(conv('"absolute left-1/2"')).toBe('"absolute inset-s-1/2"');
  });

  it('reports translate-x, origin and side variants without converting', () => {
    for (const src of ['"translate-x-full"', '"origin-left"', '"origin-top-right"', '"data-[side=left]:ml-2"']) {
      const { output, skipped } = convertSource(src);
      expect(output).toBe(src);
      expect(skipped).toHaveLength(1);
    }
  });

  it('does not touch locales or prose that only look like classes', () => {
    for (const src of ["'pl-PL'", '"ml-IN"', '"left-aligned text"', 'const side = "right"']) {
      const { output, skipped } = convertSource(src);
      expect(output).toBe(src);
      expect(skipped).toEqual([]);
    }
  });

  it('skips explicit ltr: and rtl: pairs', () => {
    const src = '"ltr:ml-2 rtl:mr-2"';
    expect(convertSource(src).output).toBe(src);
  });

  it('honours rtl-ok on the line or the line above', () => {
    const same = '"ml-2" // rtl-ok: timeline';
    expect(convertSource(same).output).toBe(same);
    const above = '// rtl-ok: timeline\n"ml-2"';
    expect(convertSource(above).output).toBe(above);
    expect(convertSource(above).skipped[0].reason).toBe('marked rtl-ok');
  });

  it('is idempotent', () => {
    const once = conv('cn("ml-2 mr-1 text-left", `pl-4 ${x}`)');
    expect(conv(once)).toBe(once);
  });

  it('reports line numbers', () => {
    const { skipped } = convertSource('a\n"translate-x-full"');
    expect(skipped[0]).toMatchObject({ line: 2, token: 'translate-x-full' });
  });
});

describe('rtl-codemod radius is LTR-safe', () => {
  // Tailwind emits rounded-s/e/ss/se/es/ee before rounded-t/b, so these must stay physical.
  it.each([
    ['rounded-t-lg rounded-l-none'],
    ['rounded-l-none rounded-t-lg'],
    ['rounded-b-md rounded-r-lg'],
    ['rounded-t-lg rounded-tl-none'],
    ['rounded-t-lg rounded-tr-none'],
    ['rounded-b-lg rounded-bl-none'],
    ['rounded-b-lg rounded-br-none'],
    ['rounded-t-lg md:rounded-l-none'],
  ])('%s is left physical and reported', (cls) => {
    const src = `"${cls}"`;
    const { output, skipped } = convertSource(src);
    expect(output).toBe(src);
    expect(skipped.some((s) => s.reason.includes('radius order'))).toBe(true);
  });

  it('still converts a radius that has no rounded-t/b neighbour', () => {
    expect(conv('"rounded-l-md rounded-r-md"')).toBe('"rounded-s-md rounded-e-md"');
    expect(conv('"rounded-lg rounded-tl-none"')).toBe('"rounded-lg rounded-ss-none"');
  });

  it('accepts a hand-written rtl: twin as the exemption in the gate', () => {
    const src = '"rounded-t-lg rounded-l-none rtl:rounded-r-none rtl:rounded-tl-lg"';
    expect(gateFindings(src)).toEqual([]);
  });

  it('the gate counts a physical radius next to rounded-t', () => {
    expect(gateFindings('"rounded-t-lg rounded-l-none"')).toHaveLength(1);
  });
});

describe('rtl-codemod centering forms', () => {
  it.each([
    ['absolute left-[50%] -translate-x-1/2'],
    ['absolute left-1/2 -translate-x-[50%]'],
    ['absolute left-1/2 -translate-1/2'],
    ['absolute left-[50%] translate-x-[-50%]'],
    ['absolute md:left-1/2 md:-translate-x-1/2'],
    ['absolute right-1/2 translate-x-[-50%]'],
  ])('%s is a centering pair, left alone', (cls) => {
    const src = `"${cls}"`;
    expect(convertSource(src).output).toBe(src);
    expect(gateFindings(src)).toEqual([]);
  });

  it('reports a lone -translate-1/2 and a lone -translate-x-[50%]', () => {
    expect(gateFindings('"-translate-1/2"')).toHaveLength(1);
    expect(gateFindings('"-translate-x-[50%]"')).toHaveLength(1);
  });
});

describe('rtl-codemod marker needs a reason', () => {
  it('an empty rtl-ok: does not exempt', () => {
    expect(convertSource('"ml-2" // rtl-ok:').output).toBe('"ms-2" // rtl-ok:');
    expect(convertSource('"ml-2" // rtl-ok: why').output).toBe('"ml-2" // rtl-ok: why');
  });
});

describe('rtl-codemod style scanning', () => {
  it('counts physical inline style keys and textAlign', () => {
    const src = [
      'const a = { paddingLeft: 8 };',
      'const b = { marginRight: 4 };',
      'const c = { left: 0, right: 2 };',
      "const d = { textAlign: 'left' };",
    ].join('\n');
    expect(gateFindings(src).map((f) => f.line)).toEqual([1, 2, 3, 3, 4]);
  });

  it('counts physical CSS and ignores logical properties', () => {
    expect(gateFindings('.a { margin-left: 4px; text-align: right; left: 6px }')).toHaveLength(3);
    expect(gateFindings('.a { margin-inline-start: 4px; inset-inline-start: 6px }')).toHaveLength(0);
  });
});
