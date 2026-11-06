import { extOf } from '@/lib/helpers';

// The text lists and the text test itself live in
// packages/shared/src/files/preview-formats.ts (through a generated copy), the
// same ones the share page uses, so a file that reads as text here also reads
// as text on its share link.
export { TEXT_READABLE_EXTS, isTextReadable } from '@/lib/preview-formats.generated';

/** Heuristic: presence of a NUL byte in the sampled prefix means "not text". */
export function looksBinary(sample: string): boolean {
  return sample.includes('\0');
}

/**
 * Decode raw file bytes to a string, honouring a UTF-16 BOM. Decoding
 * everything as UTF-8 made every UTF-16 file (Windows Notepad's "Unicode"
 * default) trip the NUL-byte binary sniff and refuse to preview.
 */
export function decodeTextBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  if (bytes.length >= 2) {
    try {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
      if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
    } catch { /* no utf-16 decoder here - fall through to utf-8 */ }
  }
  return new TextDecoder().decode(bytes);
}

// Extension → canonical Shiki language id.
const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript',
  cjs: 'javascript', py: 'python', rb: 'ruby', php: 'php', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', swift: 'swift',
  dart: 'dart', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
  lua: 'lua', pl: 'perl', r: 'r', sh: 'bash', bash: 'bash', zsh: 'bash',
  fish: 'fish', ps1: 'powershell', sql: 'sql', json: 'json', jsonc: 'jsonc',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini', xml: 'xml', html: 'html',
  htm: 'html', css: 'css', scss: 'scss', less: 'less', md: 'markdown',
  markdown: 'markdown', vue: 'vue', svelte: 'svelte', graphql: 'graphql',
  proto: 'proto', diff: 'diff', patch: 'diff', dockerfile: 'docker',
  makefile: 'make', gradle: 'groovy',
};

export function langFromExtension(name: string): string {
  const ext = extOf(name);
  if (ext && EXT_LANG[ext]) return EXT_LANG[ext];
  const base = name.toLowerCase();
  if (base === 'dockerfile') return 'docker';
  if (base === 'makefile') return 'make';
  return 'text';
}