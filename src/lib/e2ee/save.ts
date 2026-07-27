/**
 * Trigger a browser "Save As" for decrypted plaintext bytes: Blob → object
 * URL → anchor click → revoke. Kept in its own module (rather than inlined
 * in the store) so it can be swapped for a spy in tests — jsdom has no real
 * object-URL/anchor-download behavior, and the store must stay unit-testable
 * without a DOM.
 */
export function saveBytes(name: string, bytes: Uint8Array): void {
  // Cast: TS's DOM lib types `BlobPart` as an `ArrayBufferView<ArrayBuffer>`
  // (excluding `SharedArrayBuffer`-backed views), but `Uint8Array`'s generic
  // buffer type is the wider `ArrayBufferLike`. Real `Blob` construction
  // accepts any typed array view at runtime; this is a type-only mismatch.
  const blob = new Blob([bytes as unknown as BlobPart]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
