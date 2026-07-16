import { describe, it, expect } from 'vitest';
import { markerFor } from './map-marker';

describe('markerFor', () => {
  it('image file with exif → thumbnail, not approximate', () => {
    expect(markerFor({ kind: 'file', source: 'exif', extension: '.jpg' })).toEqual({ type: 'thumbnail', approximate: false });
  });

  it('non-image file → file-icon', () => {
    expect(markerFor({ kind: 'file', source: 'ip', extension: '.pdf' })).toEqual({ type: 'file-icon', approximate: true });
  });

  it('folder → folder-icon, approximate', () => {
    expect(markerFor({ kind: 'folder', source: 'ip', extension: null })).toEqual({ type: 'folder-icon', approximate: true });
  });

  it('image file with ip fallback → still thumbnail, but approximate', () => {
    expect(markerFor({ kind: 'file', source: 'ip', extension: '.png' })).toEqual({ type: 'thumbnail', approximate: true });
  });

  it('file with no extension → file-icon', () => {
    expect(markerFor({ kind: 'file', source: 'exif', extension: null })).toEqual({ type: 'file-icon', approximate: false });
  });

  it('folder with a null source is still not approximate-flagged as exif', () => {
    // Folders are always IP-derived when located; a null source (unlocated, shouldn't
    // normally reach markerFor) must not be misreported as approximate.
    expect(markerFor({ kind: 'folder', source: null, extension: null })).toEqual({ type: 'folder-icon', approximate: false });
  });
});
