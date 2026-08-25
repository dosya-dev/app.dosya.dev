import { describe, it, expect } from 'vitest';
import { MAX_CSV_RENDER_ROWS, parseCsvTable } from './csv-table';

describe('parseCsvTable', () => {
  it('parses a plain comma file with a header', () => {
    const t = parseCsvTable('name,size,kind\nreport.pdf,12,PDF\nnotes.txt,3,Text\n');
    expect(t).not.toBeNull();
    expect(t!.header).toEqual(['name', 'size', 'kind']);
    expect(t!.rows).toEqual([
      ['report.pdf', '12', 'PDF'],
      ['notes.txt', '3', 'Text'],
    ]);
    expect(t!.columns).toBe(3);
    expect(t!.delimiter).toBe(',');
  });

  it('handles quoted fields containing delimiters, escaped quotes and newlines', () => {
    const t = parseCsvTable('title,note\n"Surname, first","said ""hi""\nand left"\nplain,ok\n');
    expect(t!.rows[0]).toEqual(['Surname, first', 'said "hi"\nand left']);
    expect(t!.rows[1]).toEqual(['plain', 'ok']);
  });

  it('sniffs semicolon (European Excel) and tab (TSV)', () => {
    expect(parseCsvTable('a;b\n1,5;2,7\n')!.delimiter).toBe(';');
    expect(parseCsvTable('a\tb\n1\t2\n')!.delimiter).toBe('\t');
  });

  it('a quoted comma in the header does not vote for comma', () => {
    const t = parseCsvTable('"Surname, first";age\n"Kaya, F";30\n');
    expect(t!.delimiter).toBe(';');
    expect(t!.header).toEqual(['Surname, first', 'age']);
  });

  it('pads ragged rows to the widest row', () => {
    const t = parseCsvTable('a,b,c\n1,2\n1,2,3,4\n');
    expect(t!.columns).toBe(4);
    expect(t!.rows[0]).toEqual(['1', '2', '', '']);
  });

  it("strips Excel's BOM and CR line endings", () => {
    const t = parseCsvTable('﻿a,b\r\n1,2\r\n');
    expect(t!.header).toEqual(['a', 'b']);
    expect(t!.rows).toEqual([['1', '2']]);
  });

  it('caps rendered rows and counts what it dropped', () => {
    const body = 'a,b\n' + Array.from({ length: MAX_CSV_RENDER_ROWS + 40 }, (_, i) => `${i},x`).join('\n');
    const t = parseCsvTable(body)!;
    expect(t.rows).toHaveLength(MAX_CSV_RENDER_ROWS);
    expect(t.truncatedRows).toBe(40);
  });

  it('refuses shapes that are not usefully tables', () => {
    expect(parseCsvTable('just a sentence with no structure')).toBeNull();
    expect(parseCsvTable('one\ntwo\nthree\n')).toBeNull();
    expect(parseCsvTable('a,b\n')).toBeNull();
  });
});
