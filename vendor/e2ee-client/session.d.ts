/**
 * Passphrase unlock / identity setup (spec §5.3 VOPRF->Argon2id->KEK,
 * §5.4/§5.8 identity bundle). Composes e2ee-core's primitives against the
 * injected `ApiClient` — never re-implements any crypto here.
 */
import { type IdentityBundle } from "@dosya-dev/e2ee-core";
import type { ApiClient } from "./api.js";
export type Session = {
    kek: Uint8Array;
    identity: IdentityBundle;
};
/**
 * First-time setup: generates a fresh identity bundle and a random recovery
 * key, derives the KEK via VOPRF+Argon2id, wraps the bundle both ways
 * (passphrase KEK + recovery key), and stores everything except the
 * KEK/private keys/recovery key via `putUserKeys`.
 *
 * The recovery key is returned ONCE here — the caller must show it to the
 * user now (e.g. "save this recovery code"); it is never recoverable from
 * the server afterward.
 */
export declare function setupIdentity(api: ApiClient, passphrase: string): Promise<{
    session: Session;
    recoveryKey: Uint8Array;
}>;
/**
 * Unlock on any device: fetch the stored salt + wrapped bundle, re-derive
 * the KEK via VOPRF+Argon2id, and unwrap. Throws the SAME
 * `"e2ee: unlock failed"` error for every failure mode (wrong passphrase, no
 * identity set up yet, or a corrupt/tampered record) so a caller can never
 * distinguish "no such identity" from "wrong passphrase" by error message.
 */
export declare function unlock(api: ApiClient, passphrase: string): Promise<Session>;
