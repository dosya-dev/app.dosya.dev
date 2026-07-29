/** SHA-256 digest of `data`, via libsodium's `crypto_hash_sha256`. */
export declare function sha256(data: Uint8Array): Promise<Uint8Array>;
