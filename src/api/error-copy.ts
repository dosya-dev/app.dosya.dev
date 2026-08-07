/**
 * Sentences for the API's machine-readable error codes.
 *
 * Most endpoints already put a human sentence in `{ ok:false, error }`, and
 * those pass through untouched. A few return a stable CODE instead, because the
 * client has to branch on them rather than just display them - `folder_locked`
 * is the one that tells the files page to show an unlock prompt.
 *
 * Those codes were being rendered verbatim, so walking into a locked folder
 * showed the user the literal string "folder_locked" under "Could not load this
 * folder". The code is the contract; the sentence is presentation. Keep them
 * separate, and keep this map keyed by code.
 *
 * Only codes that can actually reach a user-facing error surface belong here.
 * Adding a sentence for a code the API never returns is worse than useless: it
 * reads as coverage that does not exist.
 */
export const API_ERROR_COPY: Record<string, string> = {
    folder_locked: 'This folder is locked. Enter its password to open it.',
};

/** The sentence for a code, or the code itself when there is no entry for it. */
export function humanizeApiError(code: string): string {
    return API_ERROR_COPY[code] ?? code;
}
