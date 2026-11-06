import { describe, expect, it } from 'vitest';
import { findSidecar, originalOf, parseSidecar, wallClock } from './sidecar';

const set = (...names: string[]) => new Set(names);

describe('findSidecar', () => {
  it('finds the 2024 and the older naming', () => {
    expect(findSidecar('IMG_1.jpg', set('IMG_1.jpg.supplemental-metadata.json'))).toBe('IMG_1.jpg.supplemental-metadata.json');
    expect(findSidecar('IMG_1.jpg', set('IMG_1.jpg.json'))).toBe('IMG_1.jpg.json');
  });

  it('finds a sidecar whose name Google cut to fit 51 characters', () => {
    const media = 'IMG_20190714_093000123_HDR_PORTRAIT.jpg';
    const cut = 'IMG_20190714_093000123_HDR_PORTRAIT.jpg.supplem.json';
    expect(findSidecar(media, set(cut, 'other.jpg.json'))).toBe(cut);
    // An old-style cut: the media name itself was cut short.
    const long = 'A very long holiday photo name from the beach at sunset.jpg';
    const oldCut = 'A very long holiday photo name from the beach a.json';
    expect(findSidecar(long, set(oldCut))).toBe(oldCut);
  });

  it('does not take a shorter photo\'s sidecar for a longer name', () => {
    expect(findSidecar('IMG_10.jpg', set('IMG_1.jpg.json'))).toBeNull();
    expect(findSidecar('IMG_1.jpg', set('IMG.json'))).toBeNull();
  });

  it('matches duplicates, edits and live-photo halves', () => {
    expect(findSidecar('IMG_1(1).jpg', set('IMG_1.jpg.supplemental-metadata(1).json', 'IMG_1.jpg.supplemental-metadata.json')))
      .toBe('IMG_1.jpg.supplemental-metadata(1).json');
    expect(findSidecar('IMG_1(2).jpg', set('IMG_1.jpg(2).json'))).toBe('IMG_1.jpg(2).json');
    expect(findSidecar('IMG_1-edited.jpg', set('IMG_1.jpg.json'))).toBe('IMG_1.jpg.json');
    expect(findSidecar('IMG_1-bearbeitet.jpg', set('IMG_1.jpg.json'))).toBe('IMG_1.jpg.json');
    expect(findSidecar('IMG_1.MP4', set('IMG_1.HEIC.supplemental-metadata.json'), ['IMG_1.HEIC', 'IMG_1.MP4']))
      .toBe('IMG_1.HEIC.supplemental-metadata.json');
  });

  it('reads the original name out of a duplicate or an edit', () => {
    expect(originalOf('IMG_1(3)-edited.jpg')).toEqual({ name: 'IMG_1.jpg', dup: '(3)' });
    expect(originalOf('IMG_1-edited(3).jpg')).toEqual({ name: 'IMG_1.jpg', dup: '(3)' });
    expect(originalOf('IMG_1(3).jpg')).toEqual({ name: 'IMG_1.jpg', dup: '(3)' });
  });
});

describe('parseSidecar', () => {
  it('reads the date taken and the place', () => {
    const meta = parseSidecar(JSON.stringify({
      title: 'IMG_1.jpg',
      photoTakenTime: { timestamp: '1563096600', formatted: 'Jul 14, 2019' },
      geoData: { latitude: 41.9028, longitude: 12.4964, altitude: 0 },
    }));
    expect(meta).toEqual({ capturedAt: wallClock(1563096600 * 1000), latitude: 41.9028, longitude: 12.4964 });
  });

  it('treats 0,0 as no place and falls back to the EXIF copy of the place', () => {
    expect(parseSidecar(JSON.stringify({ photoTakenTime: { timestamp: '1563096600' }, geoData: { latitude: 0, longitude: 0 } })))
      .toMatchObject({ latitude: null, longitude: null });
    expect(parseSidecar(JSON.stringify({
      photoTakenTime: { timestamp: '1563096600' },
      geoData: { latitude: 0, longitude: 0 }, geoDataExif: { latitude: -33.86, longitude: 151.2 },
    }))).toMatchObject({ latitude: -33.86, longitude: 151.2 });
  });

  it('answers null for an album metadata file or junk', () => {
    expect(parseSidecar(JSON.stringify({ title: 'Holiday 2024', description: '' }))).toBeNull();
    expect(parseSidecar('{nope')).toBeNull();
    expect(parseSidecar(JSON.stringify({ photoTakenTime: { timestamp: '0' } }))).toBeNull();
  });

  it('writes a zoneless wall clock', () => {
    expect(wallClock(new Date(2019, 6, 14, 9, 5, 3).getTime())).toBe('2019-07-14T09:05:03');
  });
});
