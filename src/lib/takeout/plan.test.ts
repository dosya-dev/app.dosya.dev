import { describe, expect, it } from 'vitest';
import { buildPlan, missingParts, parsePartName, type Archive } from './plan';
import type { ZipEntry } from './zip';

let crc = 1;
function entry(name: string, size = 10, sameAs?: ZipEntry): ZipEntry {
  return {
    name, isDir: name.endsWith('/'), size: sameAs?.size ?? size, storedSize: size, method: 0,
    localHeaderOffset: 0, crc32: sameAs?.crc32 ?? crc++, encrypted: false, mtime: null,
  };
}
const archive = (name: string, entries: ZipEntry[]): Archive => ({ file: { name, size: 1000 } as File, entries });

describe('buildPlan', () => {
  const beach = entry('Takeout/Google Photos/Photos from 2019/beach.jpg', 500);
  const parts = [
    archive('takeout-20261030T081200Z-001.zip', [
      entry('Takeout/archive_browser.html'),
      entry('Takeout/Google Photos/'),
      beach,
      entry('Takeout/Google Photos/Photos from 2019/beach.jpg.supplemental-metadata.json'),
      entry('Takeout/Google Photos/Photos from 2019/street.jpg', 300),
      entry('Takeout/Google Photos/Photos from 2019/street.jpg.json'),
      entry('Takeout/Google Photos/Holiday 2019/beach.jpg', 0, beach),
      entry('Takeout/Google Photos/Holiday 2019/beach.jpg.supplemental-metadata.json'),
      entry('Takeout/Google Photos/Holiday 2019/metadata.json'),
    ]),
    archive('takeout-20261030T081200Z-002.zip', [
      entry('Takeout/Google Photos/Photos from 2019/clip.mp4', 4000),
      entry('Takeout/Drive/Work/plan.docx', 70),
      entry('Takeout/Mail/All mail.mbox', 90),
    ]),
  ];

  it('keeps Google folder names under one Google Takeout folder and leaves the JSON behind', () => {
    const plan = buildPlan(parts);
    expect(plan.items.map((i) => `${i.dir}/${i.name}`)).toEqual([
      'Google Takeout/Drive/Work/plan.docx',
      'Google Takeout/Google Photos/Holiday 2019/beach.jpg',
      'Google Takeout/Google Photos/Photos from 2019/street.jpg',
      'Google Takeout/Google Photos/Photos from 2019/clip.mp4',
      'Google Takeout/Mail/All mail.mbox',
    ]);
    expect(plan).toMatchObject({ photos: 2, videos: 1, albums: 1, driveFiles: 1, otherFiles: 1, withSidecar: 2, duplicatesSkipped: 1 });
  });

  it('pairs a photo with its sidecar, even when the sidecar is in another part', () => {
    const split = [
      archive('takeout-x-001.zip', [entry('Takeout/Google Photos/Photos from 2020/a.jpg')]),
      archive('takeout-x-002.zip', [entry('Takeout/Google Photos/Photos from 2020/a.jpg.json')]),
    ];
    const [item] = buildPlan(split).items;
    expect(item.name).toBe('a.jpg');
    expect(item.sidecar?.archive).toBe(1);
    expect(item.sidecar?.entry.name).toBe('Takeout/Google Photos/Photos from 2020/a.jpg.json');
  });

  it('keeps every copy when album de-duplication is off', () => {
    const plan = buildPlan(parts, { dedupeAlbums: false });
    expect(plan.duplicatesSkipped).toBe(0);
    expect(plan.items.filter((i) => i.name === 'beach.jpg')).toHaveLength(2);
  });

  it('never treats an album named like a year as a year folder', () => {
    const p = buildPlan([archive('t.zip', [
      entry('Takeout/Google Photos/Summer 2019/x.jpg', 5),
      entry('Takeout/Google Photos/Summer 2019/x.jpg.json'),
      entry('Takeout/Google Photos/Summer 2019/metadata.json'),
      entry('Takeout/Google Photos/Photos from 2019/x.jpg', 5),
      entry('Takeout/Google Photos/Photos from 2019/x.jpg.json'),
    ])]);
    // Different CRCs: two different photos, both kept.
    expect(p.items).toHaveLength(2);
  });

  it('gives every item a key that survives choosing the same zips again', () => {
    const a = buildPlan(parts).items.map((i) => i.key);
    expect(new Set(a).size).toBe(a.length);
    expect(buildPlan(parts).items.map((i) => i.key)).toEqual(a);
  });
});

describe('parts', () => {
  it('reads the export and part from a Takeout file name', () => {
    expect(parsePartName('takeout-20261030T081200Z-001.zip')).toEqual({ exportId: '20261030T081200Z', part: 1 });
    // Google's current names: the first number is the part.
    expect(parsePartName('takeout-20261101T122519Z-3-001.zip')).toEqual({ exportId: '20261101T122519Z', part: 3 });
    expect(parsePartName('takeout-20261101T122519Z-12-002.zip')).toEqual({ exportId: '20261101T122519Z', part: 12 });
    expect(parsePartName('holiday.zip')).toBeNull();
  });

  it('names the parts missing below the highest one chosen', () => {
    expect(missingParts(['takeout-20261030T081200Z-001.zip', 'takeout-20261030T081200Z-002.zip', 'takeout-20261030T081200Z-004.zip']))
      .toEqual([{ exportId: '20261030T081200Z', part: 3 }]);
    expect(missingParts(['takeout-20261030T081200Z-002.zip'])).toEqual([{ exportId: '20261030T081200Z', part: 1 }]);
    expect(missingParts(['takeout-20261101T122519Z-3-001.zip', 'takeout-20261101T122519Z-4-001.zip']))
      .toEqual([{ exportId: '20261101T122519Z', part: 1 }, { exportId: '20261101T122519Z', part: 2 }]);
    expect(missingParts(['takeout-20261101T122519Z-1-001.zip', 'takeout-20261101T122519Z-2-001.zip'])).toEqual([]);
  });
});
