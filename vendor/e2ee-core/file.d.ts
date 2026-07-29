/**
 * File content format (spec §5.5) — manifest, per-chunk AEAD, delta reuse,
 * random-access decryption.
 *
 * Layout: a file's plaintext is split into content-defined chunks
 * (`chunkBoundaries`). Each chunk is sealed independently with
 * XChaCha20-Poly1305 under the file's DEK, a random per-chunk nonce, and
 * associated data that binds ONLY `{fmt, workspaceId, dekId}` (`adChunk`) —
 * deliberately NOT the fileId, chunk index, or chunk count. That keeps
 * ciphertext chunks content-addressable and reusable across files/versions
 * (dedup, delta sync). This is NOT convergent encryption: `encryptFile`
 * draws a fresh random nonce per chunk, so encrypting the same plaintext
 * twice yields different ciphertext/chunkId each time. Verbatim reuse of an
 * existing chunk only happens explicitly, via `computeDelta` carrying
 * forward the old chunk's `{chunkId, nonce}` when it matches by `plainHash`.
 *
 * Ordering, count, and file identity live entirely in the `FileManifest`:
 *   - `chunkId = sha256(ciphertext)` is the chunk's content address; the
 *     manifest lists chunk refs in file order, so `chunks[i]` is the i-th
 *     plaintext segment regardless of any AD.
 *   - `manifest.merkleRoot = merkleRoot(chunks.map(c => c.chunkId))` binds
 *     the exact sequence of chunk ids — reordering or truncating the
 *     `chunks` array changes the recomputed root (see
 *     `verifyManifestIntegrity`). The manifest itself is authenticated at a
 *     higher layer (P0.4, under the workspace key) — this module treats it
 *     as a plain, trusted-once-verified object.
 *   - `plainHash = sha256(plaintext chunk)` is a client-only identity used
 *     purely for delta matching (`computeDelta`); it never leaves the
 *     client's local reasoning and is not part of any AD.
 *
 * Integrity order on read matters: callers MUST verify
 * `sha256(ciphertext) === chunkId` before attempting AEAD decryption. That
 * check is cheap, fails fast on corrupt/truncated storage, and — crucially —
 * happens before any key material touches attacker-controlled bytes.
 */
import { type ChunkParams } from "./chunker.js";
export type ChunkRef = {
    chunkId: Uint8Array;
    nonce: Uint8Array;
    plainLen: number;
    plainHash: Uint8Array;
};
export type FileManifest = {
    fmt: number;
    workspaceId: string;
    fileId: string;
    version: number;
    dekId: string;
    totalSize: number;
    chunks: ChunkRef[];
    merkleRoot: Uint8Array;
};
export type EncryptedChunk = {
    chunkId: Uint8Array;
    ciphertext: Uint8Array;
};
/** Split, encrypt (fresh nonces), and build the manifest for a whole file. */
export declare function encryptFile(args: {
    dek: Uint8Array;
    dekId: string;
    fmt: number;
    workspaceId: string;
    fileId: string;
    version: number;
    plaintext: Uint8Array;
    params?: Partial<ChunkParams>;
}): Promise<{
    manifest: FileManifest;
    chunks: EncryptedChunk[];
}>;
/** Fetch, verify, and decrypt every chunk in manifest order; concatenate the plaintext. */
export declare function decryptFile(args: {
    dek: Uint8Array;
    fmt: number;
    workspaceId: string;
    dekId: string;
    manifest: FileManifest;
    getCiphertext: (chunkId: Uint8Array) => Promise<Uint8Array>;
}): Promise<Uint8Array>;
/** Decrypt only the chunks overlapping `[start, end)`, slicing to the exact byte range. */
export declare function decryptRange(args: {
    dek: Uint8Array;
    fmt: number;
    workspaceId: string;
    dekId: string;
    manifest: FileManifest;
    start: number;
    end: number;
    getCiphertext: (chunkId: Uint8Array) => Promise<Uint8Array>;
}): Promise<Uint8Array>;
/**
 * Re-chunk `newPlaintext` and diff against `oldManifest` by `plainHash`:
 * chunks whose plaintext is unchanged reuse the old `{chunkId, nonce}`
 * verbatim (no re-encryption, no new ciphertext object); everything else is
 * freshly encrypted. Returns the new manifest plus ONLY the freshly
 * encrypted chunks — the caller/server already holds the reused ones.
 */
export declare function computeDelta(args: {
    dek: Uint8Array;
    dekId: string;
    fmt: number;
    workspaceId: string;
    fileId: string;
    newVersion: number;
    oldManifest: FileManifest;
    newPlaintext: Uint8Array;
    params?: Partial<ChunkParams>;
}): Promise<{
    manifest: FileManifest;
    newChunks: EncryptedChunk[];
}>;
/** Recompute the Merkle root over `manifest.chunks` and compare to `manifest.merkleRoot`. */
export declare function verifyManifestIntegrity(manifest: FileManifest): Promise<boolean>;
