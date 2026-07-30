import { useE2ee } from '@/stores/e2ee';
import { EncryptedBrowser } from '@/components/e2ee/encrypted-browser';
import { UnlockGate, RecoveryKeyDialog } from '@/components/e2ee/unlock-gate';

export default function EncryptedPage() {
  const status = useE2ee((s) => s.status);
  return (
    <>
      {/* Unlocked, the browser owns its own full-height split layout (left
          Space menu + scrolling content), so it gets no width wrapper here -
          the same arrangement /files uses. The locked gate is a plain
          centered card and keeps the narrow wrapper. */}
      {status === 'unlocked' ? (
        <EncryptedBrowser />
      ) : (
        <div className="mx-auto w-full max-w-6xl px-4 py-6">
          <UnlockGate />
        </div>
      )}
      {/* Mounted outside the branch above so it survives setup()'s
          simultaneous status→'unlocked' flip (see unlock-gate.tsx). */}
      <RecoveryKeyDialog />
    </>
  );
}
