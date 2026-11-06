import { describe, it, expect } from 'vitest';
import { baseNameRange, blankFileBlob, blankFileBytes, nameTaken, normaliseNewFileName, NEW_FILE_SPECS } from './blank-files';

describe('normaliseNewFileName', () => {
  it('keeps a name that already has the right extension, in any case', () => {
    expect(normaliseNewFileName('Untitled.md', 'md')).toBe('Untitled.md');
    expect(normaliseNewFileName('Notes.MD', 'md')).toBe('Notes.MD');
    expect(normaliseNewFileName('report.docx', 'docx')).toBe('report.docx');
  });
  it('appends the extension when it was removed', () => {
    expect(normaliseNewFileName('notes', 'md')).toBe('notes.md');
    expect(normaliseNewFileName('todo', 'txt')).toBe('todo.txt');
    expect(normaliseNewFileName('Letter', 'docx')).toBe('Letter.docx');
  });
  it('appends the right extension when it was changed', () => {
    expect(normaliseNewFileName('notes.txt', 'md')).toBe('notes.txt.md');
    expect(normaliseNewFileName('Letter.doc', 'docx')).toBe('Letter.doc.docx');
  });
  it('trims spaces and trailing dots', () => {
    expect(normaliseNewFileName('  notes  ', 'md')).toBe('notes.md');
    expect(normaliseNewFileName('notes.', 'txt')).toBe('notes.txt');
  });
  it('returns "" for an empty name or one that is only the extension', () => {
    expect(normaliseNewFileName('', 'md')).toBe('');
    expect(normaliseNewFileName('   ', 'txt')).toBe('');
    expect(normaliseNewFileName('.md', 'md')).toBe('');
    expect(normaliseNewFileName('...', 'docx')).toBe('');
  });
});

describe('baseNameRange', () => {
  it('selects everything before the extension', () => {
    expect(baseNameRange('Untitled.md', 'md')).toEqual([0, 8]);
    expect(baseNameRange('Untitled.docx', 'docx')).toEqual([0, 8]);
  });
  it('selects the whole name when it lacks the extension', () => {
    expect(baseNameRange('notes', 'txt')).toEqual([0, 5]);
  });
});

describe('nameTaken', () => {
  const items = [{ name: 'Report.docx' }, { name: 'Drafts' }];
  it('matches exactly, ignoring case', () => {
    expect(nameTaken('report.DOCX', items)).toBe(true);
    expect(nameTaken('drafts', items)).toBe(true);
  });
  it('does not match a substring', () => {
    expect(nameTaken('Report.doc', items)).toBe(false);
    expect(nameTaken('Draft', items)).toBe(false);
  });
});

describe('blank file bytes', () => {
  it('Markdown and text are empty', () => {
    expect(blankFileBytes('md').length).toBe(0);
    expect(blankFileBytes('txt').length).toBe(0);
  });
  it('the Word document is a real OOXML zip with word/document.xml', () => {
    const bytes = blankFileBytes('docx');
    expect(bytes.length).toBe(1735);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK');
    const latin1 = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    expect(latin1).toContain('word/document.xml');
    expect(latin1).toContain('[Content_Types].xml');
  });
  it('blobs carry the kind mime type and size', () => {
    expect(blankFileBlob('docx').type).toBe(NEW_FILE_SPECS.docx.mimeType);
    expect(blankFileBlob('docx').size).toBe(1735);
    expect(blankFileBlob('md').type).toBe('text/markdown');
    expect(blankFileBlob('txt').type).toBe('text/plain');
  });
});
