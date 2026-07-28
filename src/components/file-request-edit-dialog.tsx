import { useState } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ChevronDown, FolderOpen, Home, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { FolderPickerDialog } from '@/components/folder-picker-dialog';

export interface EditableFileRequest {
  id: string;
  title: string | null;
  message: string | null;
  expires_at: number | null;
  is_password_protected: number;
  folder_id: string | null;
  folder_name?: string | null;
  allowed_extensions: string | null;
  max_file_size_bytes: number | null;
  max_files: number | null;
}

const MB = 1024 * 1024;

export function FileRequestEditDialog({ request: r, workspaceId, onClose, onSaved }: {
  request: EditableFileRequest;
  workspaceId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(r.title ?? '');
  const [message, setMessage] = useState(r.message ?? '');
  const [expiry, setExpiry] = useState(r.expires_at ? 'keep' : '0');
  const [password, setPassword] = useState('');
  const [removePassword, setRemovePassword] = useState(false);
  const [folderId, setFolderId] = useState<string | null>(r.folder_id);
  const [folderName, setFolderName] = useState(r.folder_name ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allowedExts, setAllowedExts] = useState(r.allowed_extensions ?? '');
  const [maxSizeMb, setMaxSizeMb] = useState(r.max_file_size_bytes ? String(Math.round(r.max_file_size_bytes / MB)) : '');
  const [maxFiles, setMaxFiles] = useState(r.max_files != null ? String(r.max_files) : '');
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(r.allowed_extensions || r.max_file_size_bytes || r.max_files != null),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const expiryOptions = [
    ...(r.expires_at ? [{
      value: 'keep',
      label: `Keep current (${new Date(r.expires_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`,
    }] : []),
    { value: '0', label: 'Never' },
    { value: '1', label: '1 day' },
    { value: '7', label: '7 days' },
    { value: '30', label: '30 days' },
    { value: '90', label: '90 days' },
  ];

  const handleSave = async () => {
    setError('');
    const body: Record<string, unknown> = {};

    if (title.trim() !== (r.title ?? '')) body.title = title.trim();
    if (message.trim() !== (r.message ?? '')) body.message = message.trim();
    if (expiry !== 'keep' && !(expiry === '0' && r.expires_at == null)) {
      body.expires_in_days = Number(expiry);
    }
    if (removePassword) {
      body.password = '';
    } else if (password.trim()) {
      if (password.trim().length < 8) { setError('Password must be at least 8 characters.'); return; }
      body.password = password.trim();
    }
    if (folderId !== r.folder_id) body.folder_id = folderId;
    if (allowedExts.trim() !== (r.allowed_extensions ?? '')) body.allowed_extensions = allowedExts.trim();
    const origMb = r.max_file_size_bytes ? String(Math.round(r.max_file_size_bytes / MB)) : '';
    if (maxSizeMb.trim() !== origMb) body.max_file_size_mb = maxSizeMb.trim() ? Number(maxSizeMb) : null;
    const origMaxFiles = r.max_files != null ? String(r.max_files) : '';
    if (maxFiles.trim() !== origMaxFiles) body.max_files = maxFiles.trim() ? Number(maxFiles) : null;

    if (Object.keys(body).length === 0) { onClose(); return; }

    setSaving(true);
    try {
      const res = await api<{ ok: boolean; error?: string }>(`/api/file-requests/${r.id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success('Request updated', 'Your changes have been saved.');
        onSaved();
      } else {
        setError(res.error ?? 'Failed to save');
        setSaving(false);
      }
    } catch {
      setError('Network error');
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={() => onClose()}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit request</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 -mx-4 px-4">
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1 block">Title <span className="font-normal">(optional)</span></Label>
              <Input value={title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} placeholder="e.g. Q1 invoices" className="h-8 text-xs" />
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1 block">Message <span className="font-normal">(optional)</span></Label>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Please send the signed contracts..." className="h-14 min-h-0 px-3 text-xs md:text-xs resize-y" />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <Label className="text-xs font-medium text-muted-foreground mb-1 block">Password</Label>
                {r.is_password_protected && !removePassword ? (
                  <Input type="password" value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} placeholder="Leave blank to keep" className="h-8 text-xs" autoComplete="off" />
                ) : !r.is_password_protected ? (
                  <Input type="password" value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} placeholder="Min 8 chars (optional)" className="h-8 text-xs" autoComplete="off" />
                ) : (
                  <div className="h-8 flex items-center text-xs text-muted-foreground italic">Will be removed</div>
                )}
                {r.is_password_protected ? (
                  <label className="flex items-center gap-1.5 mt-1.5 text-[11px] text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={removePassword} onChange={(e) => { setRemovePassword(e.target.checked); if (e.target.checked) setPassword(''); }} className="size-3" />
                    Remove password
                  </label>
                ) : null}
              </div>
              <div className="flex-1">
                <Label className="text-xs font-medium text-muted-foreground mb-1 block">Expires</Label>
                <Select value={expiry} onValueChange={(v) => setExpiry(v as string)} items={expiryOptions}>
                  <SelectTrigger className="w-full h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {expiryOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-1 block">Upload destination</Label>
              <button
                type="button"
                className="w-full h-8 border rounded-md px-2.5 text-xs bg-background flex items-center gap-2 hover:bg-muted/50 text-left"
                onClick={() => setPickerOpen(true)}
              >
                {folderId ? (
                  <>
                    <FolderOpen className="size-3 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">{folderName || 'Selected folder'}</span>
                  </>
                ) : (
                  <>
                    <Home className="size-3 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">Root (workspace top level)</span>
                  </>
                )}
                <ChevronDown className="size-3 text-muted-foreground shrink-0" />
              </button>
            </div>

            <div>
              <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => setShowAdvanced(!showAdvanced)}>
                <ChevronDown className={`size-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} /> Advanced options
              </button>
              {showAdvanced && (
                <div className="mt-2 space-y-3">
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground mb-1 block">Allowed extensions</Label>
                    <Input value={allowedExts} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAllowedExts(e.target.value)} placeholder=".pdf, .docx, .jpg" className="h-8 text-xs" />
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Label className="text-xs font-medium text-muted-foreground mb-1 block">Max file size (MB)</Label>
                      <Input type="number" value={maxSizeMb} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxSizeMb(e.target.value)} placeholder="No limit" className="h-8 text-xs" />
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs font-medium text-muted-foreground mb-1 block">Max files</Label>
                      <Input type="number" value={maxFiles} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxFiles(e.target.value)} placeholder="Unlimited" className="h-8 text-xs" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {error && <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {pickerOpen && (
        <FolderPickerDialog
          open
          onClose={() => setPickerOpen(false)}
          workspaceId={workspaceId}
          selectedId={folderId}
          selectedName={folderName}
          onSelect={(id, name) => { setFolderId(id); setFolderName(id ? name : ''); setPickerOpen(false); }}
        />
      )}
    </>
  );
}
