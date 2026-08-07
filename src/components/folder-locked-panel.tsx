/**
 * The password prompt for a full_lock folder.
 *
 * Before this existed the server's 403 was the end of the road: the listing
 * failed with `{ error: "folder_locked" }`, the files page rendered that string
 * verbatim under "Could not load this folder", and nothing ever called
 * POST /api/folders/:id/unlock - so the lock could be SET from the UI but never
 * opened by it. Files had this flow (file-detail-panel, and the page's own
 * unlock dialog); folders were simply missed.
 *
 * Rendered inline, in place of the listing, rather than as a modal on purpose:
 * this state is reached by navigating (a click, a deep link, a refresh, or an
 * unlock token quietly expiring after its hour), and a dialog that reopens
 * itself every time the query retries is a trap with no way out. Inline, the
 * field is simply there, and "Go back" is a real escape.
 */
import { useState } from 'react';
import { Lock, Loader2, ArrowLeft } from 'lucide-react';
import { api, ApiError, apiErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface FolderLockedPanelProps {
    folderId: string;
    /** Known when the user clicked a row; null on a deep link, where the failed listing carries no name. */
    folderName?: string | null;
    /** Hands the fresh unlock token up so the listing can be re-requested with `ut=`. */
    onUnlocked: (token: string) => void;
    onBack: () => void;
}

export function FolderLockedPanel({ folderId, folderName, onUnlocked, onBack }: FolderLockedPanelProps) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const submit = async () => {
        if (!password.trim() || submitting) return;
        setSubmitting(true);
        setError('');
        try {
            const res = await api<{ ok: boolean; unlock_token?: string; error?: string }>(
                `/api/folders/${folderId}/unlock`,
                { method: 'POST', body: JSON.stringify({ password }) },
            );
            if (res.ok && res.unlock_token) {
                onUnlocked(res.unlock_token);
            } else {
                setError(res.error ?? 'Incorrect password');
                setPassword('');
            }
        } catch (err) {
            // api() throws on non-2xx, so a rejected password lands here rather
            // than in the else branch above. Clear the field on a real answer
            // from the server, but keep it on a network failure - retyping a
            // password because the wifi blipped is its own small insult.
            setError(apiErrorMessage(err, "Can't reach the server. Check your connection and try again."));
            if (err instanceof ApiError) setPassword('');
        }
        setSubmitting(false);
    };

    return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted mb-4">
                <Lock className="size-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">
                {folderName ? `"${folderName}" is locked` : 'This folder is locked'}
            </p>
            <p className="text-xs text-muted-foreground max-w-80 mb-4">
                Enter the folder password to see what is inside. Access stays open for one hour.
            </p>

            {error && (
                <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2 mb-3 max-w-72">
                    {error}
                </p>
            )}

            <div className="flex items-center gap-2 w-full max-w-72">
                <Input
                    type="password"
                    value={password}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submit()}
                    placeholder="Folder password"
                    className="h-9"
                    autoFocus
                />
                <Button size="sm" className="h-9 shrink-0" onClick={submit} disabled={submitting || !password.trim()}>
                    {submitting && <Loader2 className="size-4 animate-spin mr-1.5" />} Unlock
                </Button>
            </div>

            <Button variant="ghost" size="sm" className="h-7 text-xs mt-3 text-muted-foreground" onClick={onBack}>
                <ArrowLeft className="size-3 mr-1" /> Go back
            </Button>
        </div>
    );
}
