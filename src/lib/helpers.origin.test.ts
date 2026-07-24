import { describe, it, expect } from 'vitest';
import { originLabel } from './helpers';

describe('originLabel', () => {
  it('maps stored origin values to display names', () => {
    expect(originLabel('web')).toBe('Web');
    expect(originLabel('desktop')).toBe('Desktop');
    expect(originLabel('mobile')).toBe('Mobile');
    expect(originLabel('cli')).toBe('CLI');
    expect(originLabel('webdav')).toBe('WebDAV');
    expect(originLabel('s3')).toBe('S3');
    expect(originLabel('ftp')).toBe('FTP');
    expect(originLabel('import')).toBe('Import');
  });

  it('shows an em dash for legacy/unknown values', () => {
    expect(originLabel(null)).toBe('—');
    expect(originLabel(undefined)).toBe('—');
    expect(originLabel('surprise')).toBe('—');
  });
});
