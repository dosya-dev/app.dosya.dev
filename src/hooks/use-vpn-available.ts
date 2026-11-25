import { useQuery } from '@tanstack/react-query';
import { getVpn, isFailure } from '@/api/vpn';

/**
 * Whether to show the VPN in the sidebar: GET /api/vpn answers (it is 404 while
 * the rollout gate is closed for this user). Checked rarely; the page itself
 * polls on its own key.
 */
export function useVpnAvailable(): boolean {
  const q = useQuery({
    queryKey: ['vpn', 'available'],
    queryFn: async () => {
      const r = await getVpn();
      return !isFailure(r) && Array.isArray((r as { locations?: unknown }).locations);
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  return q.data === true;
}
