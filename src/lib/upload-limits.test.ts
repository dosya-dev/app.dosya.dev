import { describe, it, expect } from 'vitest';
import { screenBatch, summariseRejections } from './upload-limits';

const f = (name: string, size = 1) => ({ name, size });
const nameOf = (x: { name: string }) => x.name;
const sizeOf = (x: { size: number }) => x.size;

describe('screenBatch', () => {
  it('passes everything through when the workspace has no limits', () => {
    const r = screenBatch([f('a.exe'), f('b.txt')], {}, nameOf, sizeOf);
    expect(r.accepted).toHaveLength(2);
    expect(r.rejected).toEqual([]);
    expect(r.quotaWarning).toBeNull();
  });

  it('splits on the blocklist and carries the server sentence', () => {
    const r = screenBatch(
      [f('a.exe'), f('b.txt')], { blocked_extensions: '.exe' }, nameOf, sizeOf,
    );
    expect(r.accepted.map(nameOf)).toEqual(['b.txt']);
    expect(r.rejected).toEqual([
      { name: 'a.exe', reason: 'File type .exe is not allowed in this workspace' },
    ]);
  });

  // The quota figure is a hint off a 60s-cached counter, so it warns and the
  // files stay queued. Refusing on it would block uploads that would have
  // succeeded.
  it('warns about the quota without rejecting anything', () => {
    const r = screenBatch(
      [f('big.bin', 300)], { storage_remaining_bytes: 100 }, nameOf, sizeOf,
    );
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toEqual([]);
    expect(r.quotaWarning).toContain('larger than the space left');
  });

  it('counts only accepted files toward the quota warning', () => {
    // The .exe is dropped, so what remains fits and there is nothing to warn on.
    const r = screenBatch(
      [f('a.exe', 500), f('b.txt', 50)],
      { blocked_extensions: '.exe', storage_remaining_bytes: 100 },
      nameOf, sizeOf,
    );
    expect(r.quotaWarning).toBeNull();
  });
});

describe('summariseRejections', () => {
  it('names the file when there is only one', () => {
    expect(summariseRejections([{ name: 'a.exe', reason: 'Nope' }])).toBe('a.exe: Nope');
  });

  it('counts rather than listing when one reason dominates', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `f${i}.exe`, reason: 'Nope' }));
    expect(summariseRejections(many)).toBe('Nope (40 files)');
  });

  it('names the dominant reason and counts the rest', () => {
    const mixed = [
      { name: 'a.exe', reason: 'Blocked' },
      { name: 'b.exe', reason: 'Blocked' },
      { name: 'c.bin', reason: 'Too big' },
    ];
    expect(summariseRejections(mixed)).toBe('Blocked (2 files), and 1 other reason');
  });
});
