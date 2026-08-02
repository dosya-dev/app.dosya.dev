import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, Cloud, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { enqueue } from '@/lib/upload-runner';
import { useWorkspace } from '@/stores/workspace';
import { useOnboarding } from '@/stores/onboarding';
import { PurposePicker } from './purpose-picker';
import { OnboardingChecklist } from './onboarding-checklist';

interface FirstRunHomeProps {
  userName: string;
}

/**
 * What `/` renders while the workspace has no files.
 *
 * The condition is about the WORKSPACE being empty, not the account being
 * new, which means this also rescues every account that signed up months ago
 * and never uploaded anything.
 *
 * The dropzone deliberately calls the same enqueue() the Files page uses, so
 * a user's first upload takes the identical code path as every upload after
 * it. There is no separate "onboarding upload" to drift out of sync.
 */
export function FirstRunHome({ userName }: FirstRunHomeProps) {
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const purpose = useOnboarding((s) => s.purpose);
  const steps = useOnboarding((s) => s.steps);
  const setPurpose = useOnboarding((s) => s.setPurpose);
  const [skipped, setSkipped] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const firstName = userName.split(' ')[0];
  const showPicker = purpose === null && !skipped;

  const send = (files: FileList | File[] | null) => {
    if (!files || !wsId) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    enqueue(list, { workspace_id: wsId, folder_id: null });
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Welcome to dosya, {firstName}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Put your first file in and this page turns into your dashboard.
        </p>
      </div>

      <div
        data-testid="first-run-dropzone"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); send(e.dataTransfer?.files ?? null); }}
        onClick={() => inputRef.current?.click()}
        className={`rounded-xl border-2 border-dashed p-12 text-center cursor-pointer transition-colors ${
          dragging ? 'border-primary bg-primary/5' : 'hover:border-foreground/20 hover:bg-muted/30'
        }`}
      >
        <Upload className="size-8 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm font-medium">Drop files here to upload</p>
        <p className="text-xs text-muted-foreground mt-1">or click to browse your computer</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { send(e.target.files); e.target.value = ''; }}
        />
      </div>

      {/* "My data is already somewhere else" is the common case for a storage
          product. Making those users drag a file to prove the thing works is
          the wrong ask, so the alternatives sit right under the dropzone. */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Already have your files somewhere?</p>
        <div className="flex flex-wrap gap-2">
          <Link to="/integrations/google">
            <Button variant="outline" size="sm" className="h-8 text-xs"><Cloud className="size-3.5 mr-1.5" /> Import from Google Drive</Button>
          </Link>
          <Link to="/integrations/remote-download">
            <Button variant="outline" size="sm" className="h-8 text-xs"><Link2 className="size-3.5 mr-1.5" /> Paste a URL</Button>
          </Link>
          <Link to="/integrations">
            <Button variant="outline" size="sm" className="h-8 text-xs">Connect a client</Button>
          </Link>
        </div>
      </div>

      {/* steps is null when the onboarding fetch failed. Onboarding is
          additive: the dropzone above is the part that matters, and it stands
          on its own. */}
      {steps && (
        showPicker ? (
          <PurposePicker onPick={(p) => { void setPurpose(p); }} onSkip={() => setSkipped(true)} />
        ) : (
          <OnboardingChecklist purpose={purpose} steps={steps} />
        )
      )}
    </div>
  );
}
