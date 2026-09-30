/**
 * One line per failed address, unless every address failed for the same
 * reason - a role that is not grantable fails them all with one identical 403
 * sentence, and repeating it N times buried the reason under the addresses.
 */
export function summarizeInviteFailures(failures: { addr: string; message: string }[]): string {
  if (failures.length > 1 && failures.every((f) => f.message === failures[0].message)) {
    return `${failures[0].message} (${failures.map((f) => f.addr).join(', ')})`;
  }
  return failures.map((f) => `${f.addr}: ${f.message}`).join(' · ');
}
