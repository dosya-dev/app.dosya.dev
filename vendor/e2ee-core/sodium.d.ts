import _sodium from "libsodium-wrappers-sumo";
export type Sodium = typeof _sodium;
/** Resolve once libsodium's WASM is initialized; returns the singleton instance. */
export declare function getSodium(): Promise<Sodium>;
