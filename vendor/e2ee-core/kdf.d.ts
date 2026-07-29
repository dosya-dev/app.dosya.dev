export declare const KDF_SALTBYTES = 16;
export type Argon2Params = {
    opslimit: number;
    memlimit: number;
};
export declare const ARGON2_TIERS: {
    interactive: Argon2Params;
    moderate: Argon2Params;
    sensitive: Argon2Params;
};
export declare function loadArgon2Tiers(): Promise<void>;
export declare function deriveKey(password: Uint8Array, salt: Uint8Array, params: Argon2Params, outLen?: number): Promise<Uint8Array>;
