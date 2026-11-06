import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn: x-axis shorthands override logical classes', () => {
  it.each([
    [['ms-2', 'mx-auto'], 'mx-auto'],
    [['me-2', 'mx-4'], 'mx-4'],
    [['ps-3', 'px-4'], 'px-4'],
    [['pe-3', 'px-4'], 'px-4'],
    [['inset-s-0', 'inset-x-2'], 'inset-x-2'],
    [['start-0', 'inset-x-2'], 'inset-x-2'],
    [['end-0', 'inset-x-2'], 'inset-x-2'],
    [['border-s', 'border-x'], 'border-x'],
    [['border-e-2', 'border-x-4'], 'border-x-4'],
    [['border-s-red-500', 'border-x-blue-500'], 'border-x-blue-500'],
    [['scroll-ms-2', 'scroll-mx-4'], 'scroll-mx-4'],
    [['scroll-pe-2', 'scroll-px-4'], 'scroll-px-4'],
  ])('%j gives %s', (input, out) => {
    expect(cn(...(input as string[]))).toBe(out);
  });

  it('keeps the old behaviour for physical classes', () => {
    expect(cn('ml-2', 'mx-auto')).toBe('mx-auto');
    expect(cn('pl-2', 'px-4')).toBe('px-4');
  });

  it('a later logical class still overrides an earlier shorthand only on its own side', () => {
    expect(cn('mx-4', 'ms-2')).toBe('mx-4 ms-2');
    expect(cn('ms-2', 'ms-4')).toBe('ms-4');
    expect(cn('p-4', 'ps-2')).toBe('p-4 ps-2');
  });
});
