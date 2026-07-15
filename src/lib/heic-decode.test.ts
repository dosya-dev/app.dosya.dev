import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { decodeHeicToRgba } from './heic-decode';

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/sample.heic'
);

describe('decodeHeicToRgba', () => {
  it(
    'decodes a real HEIC file into non-blank RGBA pixel data',
    async () => {
      const bytes = readFileSync(fixturePath);

      const result = await decodeHeicToRgba(bytes);

      expect(result.width).toBe(320);
      expect(result.height).toBe(240);
      expect(result.data.length).toBe(320 * 240 * 4);

      // First pixel is known-good from the fixture: RGBA(101, 159, 222, 255).
      expect(result.data[0]).toBe(101);
      expect(result.data[1]).toBe(159);
      expect(result.data[2]).toBe(222);
      expect(result.data[3]).toBe(255);

      let nonBlankPixels = 0;
      let opaquePixels = 0;
      const pixelCount = result.width * result.height;
      for (let i = 0; i < pixelCount; i++) {
        const o = i * 4;
        const r = result.data[o];
        const g = result.data[o + 1];
        const b = result.data[o + 2];
        const a = result.data[o + 3];
        if (r !== 0 || g !== 0 || b !== 0) nonBlankPixels++;
        if (a === 255) opaquePixels++;
      }

      expect(nonBlankPixels).toBe(pixelCount);
      expect(opaquePixels).toBe(pixelCount);
    },
    { timeout: 30000 }
  );

  it('throws a clear error when there are no images to decode', async () => {
    // Garbage bytes: not a valid HEIC, so libheif should yield zero images
    // (or throw internally) rather than silently returning something usable.
    const bogus = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);

    await expect(decodeHeicToRgba(bogus)).rejects.toThrow();
  });
});
