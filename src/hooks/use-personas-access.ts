// Whether the Personas entry points show (the Files sidebar row, the global
// search's people and settings row). Personas runs on each member's own
// devices and is free on every plan, so it shows for every signed-in user;
// `ask` lets a caller hold it back (a role that may not see files has no
// photos to read). Nothing is asked of a server.
import { useSession } from '@/stores/session';

export function usePersonasVisible(ask = true): boolean {
  const signedIn = useSession((s) => !!s.user?.id);
  return signedIn && ask;
}
