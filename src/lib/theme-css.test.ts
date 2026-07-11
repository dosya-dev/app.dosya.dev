import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { THEME_IDS } from './themes';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, '../index.css'), 'utf8');

describe('theme CSS blocks', () => {
  it('defines a light + dark block for every non-default theme id', () => {
    for (const id of THEME_IDS) {
      if (id === 'default') continue; // default uses :root / .dark
      expect(css, `light block for ${id}`).toContain(`[data-theme="${id}"]`);
      expect(css, `dark block for ${id}`).toContain(`[data-theme="${id}"].dark`);
    }
  });
});
