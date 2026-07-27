import { useE2ee } from '@/stores/e2ee';
import { EncryptedBrowser } from '@/components/e2ee/encrypted-browser';
import { UnlockGate, RecoveryKeyDialog } from '@/components/e2ee/unlock-gate';

export default function EncryptedPage() {
  const status = useE2ee((s) => s.status);
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      {status === 'unlocked' ? <EncryptedBrowser /> : <UnlockGate />}
      {/* Mounted outside the branch above so it survives setup()'s
          simultaneous status→'unlocked' flip (see unlock-gate.tsx). */}
      <RecoveryKeyDialog />
    </div>
  );
}
