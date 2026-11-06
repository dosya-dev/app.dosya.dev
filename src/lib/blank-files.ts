/**
 * The blank files the files page's "New" menu creates: what each kind is
 * called, its extension and mime type, and its bytes. Pure and React-free so
 * the naming rules are unit-testable.
 *
 * Markdown and text start empty (the upload API accepts 0 bytes). A Word
 * document cannot: an empty .docx is not a document, so the editor would
 * refuse it. BLANK_DOCX_BASE64 is a minimal valid OOXML package (1735 bytes):
 * [Content_Types].xml, _rels/.rels, word/document.xml with one empty
 * paragraph, and its relationships.
 */

export type NewFileKind = 'md' | 'txt' | 'docx';

export interface NewFileSpec {
  kind: NewFileKind;
  /** With the dot, lower case. */
  extension: string;
  mimeType: string;
  defaultName: string;
}

export const NEW_FILE_SPECS: Record<NewFileKind, NewFileSpec> = {
  md: { kind: 'md', extension: '.md', mimeType: 'text/markdown', defaultName: 'Untitled.md' },
  txt: { kind: 'txt', extension: '.txt', mimeType: 'text/plain', defaultName: 'Untitled.txt' },
  docx: {
    kind: 'docx',
    extension: '.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    defaultName: 'Untitled.docx',
  },
};

export const BLANK_DOCX_BASE64 =
  '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';

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** The bytes a new file of this kind starts with. */
export function blankFileBytes(kind: NewFileKind): Uint8Array<ArrayBuffer> {
  return kind === 'docx' ? base64ToBytes(BLANK_DOCX_BASE64) : new Uint8Array(new ArrayBuffer(0));
}

export function blankFileBlob(kind: NewFileKind): Blob {
  return new Blob([blankFileBytes(kind)], { type: NEW_FILE_SPECS[kind].mimeType });
}

/**
 * Keeps the extension right whatever was typed: "notes" -> "notes.md",
 * "notes.txt" -> "notes.txt.md" for a Markdown file, "Notes.MD" stays.
 * Trailing dots go before the extension is added ("notes." -> "notes.md").
 * A name that is only the extension (or empty) comes back as "", so the
 * name validator reports it as missing.
 */
export function normaliseNewFileName(input: string, kind: NewFileKind): string {
  const { extension } = NEW_FILE_SPECS[kind];
  const trimmed = input.trim();
  if (trimmed.toLowerCase().endsWith(extension)) {
    return trimmed.length > extension.length ? trimmed : '';
  }
  const base = trimmed.replace(/\.+$/, '').trim();
  return base ? base + extension : '';
}

/** The part of a default name to preselect: everything before the extension. */
export function baseNameRange(name: string, kind: NewFileKind): [number, number] {
  const { extension } = NEW_FILE_SPECS[kind];
  const end = name.toLowerCase().endsWith(extension) ? name.length - extension.length : name.length;
  return [0, end];
}

/**
 * Whether `name` is already used in the folder. The upload API turns a
 * same-name upload into a new version of the existing file, so a new file
 * must never reuse a name. Case-insensitive, and folders count too.
 */
export function nameTaken(name: string, existing: Iterable<{ name: string }>): boolean {
  const want = name.trim().toLowerCase();
  for (const item of existing) {
    if (item.name.trim().toLowerCase() === want) return true;
  }
  return false;
}
