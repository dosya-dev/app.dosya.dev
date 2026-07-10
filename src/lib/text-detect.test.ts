import { describe, it, expect } from 'vitest';
import { isTextReadable, looksBinary, langFromExtension } from './text-detect';

describe('isTextReadable', () => {
  it('accepts broadened code/config extensions', () => {
    expect(isTextReadable('main.go')).toBe(true);
    expect(isTextReadable('Cargo.toml')).toBe(true);
    expect(isTextReadable('script.sh')).toBe(true);
  });
  it('accepts extensionless known text files (case-insensitive)', () => {
    expect(isTextReadable('Dockerfile')).toBe(true);
    expect(isTextReadable('makefile')).toBe(true);
    expect(isTextReadable('README')).toBe(true);
    expect(isTextReadable('.gitignore')).toBe(true);
  });
  it('accepts text-ish mime types even for unknown extensions', () => {
    expect(isTextReadable('data.weird', 'text/plain')).toBe(true);
    expect(isTextReadable('payload.bin', 'application/json')).toBe(true);
  });
  it('rejects binaries', () => {
    expect(isTextReadable('photo.png', 'image/png')).toBe(false);
    expect(isTextReadable('movie.mp4')).toBe(false);
    expect(isTextReadable('archive.zip', 'application/zip')).toBe(false);
  });
});

describe('looksBinary', () => {
  it('flags content containing a NUL byte', () => {
    expect(looksBinary('abc\u0000def')).toBe(true);
  });
  it('passes normal text', () => {
    expect(looksBinary('const x = 1;\nhello world')).toBe(false);
  });
});

describe('langFromExtension', () => {
  it('maps known extensions to Shiki language ids', () => {
    expect(langFromExtension('a.ts')).toBe('typescript');
    expect(langFromExtension('a.py')).toBe('python');
    expect(langFromExtension('a.rs')).toBe('rust');
    expect(langFromExtension('a.yml')).toBe('yaml');
  });
  it('falls back to text for unknown extensions', () => {
    expect(langFromExtension('a.unknownext')).toBe('text');
  });
});
