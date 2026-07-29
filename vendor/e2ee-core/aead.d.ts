export declare const AEAD_KEYBYTES = 32;
export declare const AEAD_NPUBBYTES = 24;
export declare function aeadEncrypt(key: Uint8Array, plaintext: Uint8Array, ad: Uint8Array, nonce?: Uint8Array): Promise<{
    nonce: Uint8Array;
    ciphertext: Uint8Array;
}>;
export declare function aeadDecrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, ad: Uint8Array): Promise<Uint8Array>;
