import { useId, useState } from 'react';
import { ChevronDown, Loader2, ShieldCheck } from 'lucide-react';
import { req } from '@/api/req';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { FolderPickerDialog } from '@/components/folder-picker-dialog';
import { toast } from '@/lib/toast';
import { LIMITS, validateApiKeyName } from '@/lib/validation-policy.generated';
import {
  type KeyDraft, type WorkspaceRef,
  DAY_OPTIONS, EXPIRY_OPTIONS, SCOPE_OPTIONS, SURFACE_OPTIONS, WHOLE_ACCOUNT,
  buildCreateBody, describeDraft, draftGuards, emptyDraft, restrictionCount, timezoneOptions,
} from '@/lib/api-keys';

// The create form, two tiers. A name and one question - what can it do? -
// are the whole first tier. Everything else sits behind "Restrictions and
// expiry", grouped by the question each group answers, with a live count so
// nothing set there is hidden. The sentence at the bottom reads the key
// back before it exists; it is the part people actually check.
export function CreateKeyDialog({ open, onOpenChange, workspaces, initialDraft, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: WorkspaceRef[];
  // "Duplicate settings" passes a draft built from an existing key.
  initialDraft?: KeyDraft;
  onCreated: (plainKey: string, draft: KeyDraft) => void;
}) {
  // State is initialised once per mount; the section remounts this dialog
  // (via `key`) on every open, so a duplicated key's draft and a blank one
  // both start clean. A draft that carries restrictions opens the second
  // tier so they're visible.
  const [draft, setDraft] = useState<KeyDraft>(() => initialDraft ?? emptyDraft());
  const [advancedOpen, setAdvancedOpen] = useState(() => restrictionCount(initialDraft ?? emptyDraft()) > 0);
  const [nameError, setNameError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const ids = { name: useId(), ips: useId(), rpm: useId(), egress: useId(), fsize: useId(), conc: useId() };

  const set = <K extends keyof KeyDraft>(k: K, v: KeyDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const toggleIn = (k: 'surfaces' | 'days', value: string | number) => setDraft((d) => {
    const next = new Set(d[k] as Set<string | number>);
    if (next.has(value)) next.delete(value); else next.add(value);
    return { ...d, [k]: next };
  });

  const count = restrictionCount(draft);
  const guards = draftGuards(draft);
  const anchored = draft.workspaceId !== WHOLE_ACCOUNT;

  const submit = async () => {
    const err = draft.name.trim() ? validateApiKeyName(draft.name) : 'Give the key a name so you can recognise it later.';
    if (err) { setNameError(err); return; }
    setCreating(true);
    const res = await req<{ ok: boolean; key?: { plain_key: string }; error?: string }>('/api/me/api-keys', {
      method: 'POST', body: JSON.stringify(buildCreateBody(draft)),
    });
    setCreating(false);
    if (res.ok && res.key) { onCreated(res.key.plain_key, draft); onOpenChange(false); }
    else toast.error('Create failed', res.error ?? 'The API key could not be created.');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New API key</DialogTitle>
          <DialogDescription>A key lets an app or a script reach your files without your password.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1 -mr-1">
          {/* Tier 1: name */}
          <div>
            <label htmlFor={ids.name} className="text-xs font-medium block mb-1.5">What is it for?</label>
            <Input
              id={ids.name} data-testid="create-name" placeholder="e.g. rclone backup"
              value={draft.name} maxLength={LIMITS.API_KEY_NAME_MAX} className="h-9 text-sm"
              aria-invalid={nameError ? true : undefined}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { set('name', e.target.value); setNameError(null); }}
            />
            <p className={`text-[11px] mt-1 ${nameError ? 'text-destructive' : 'text-muted-foreground'}`}>
              {nameError ?? 'Just a label, so you can recognise it later.'}
            </p>
          </div>

          {/* Tier 1: permission */}
          <div>
            <p className="text-xs font-medium mb-1.5">What can it do?</p>
            <RadioGroup value={draft.scope} onValueChange={(v) => set('scope', String(v))} aria-label="Permission" className="gap-1.5">
              {SCOPE_OPTIONS.map((o) => (
                <OptionCard key={o.value} testId={`scope-${o.value}`} selected={draft.scope === o.value}>
                  <RadioGroupItem value={o.value} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-[13px] font-medium leading-5">
                      {o.label}
                      {o.value === 'full' && <Badge variant="secondary" className="text-[10px] font-medium text-amber-700 dark:text-amber-400">most permissive</Badge>}
                    </span>
                    <span className="block text-[11px] text-muted-foreground leading-snug">{o.blurb}</span>
                  </span>
                </OptionCard>
              ))}
            </RadioGroup>
          </div>

          {/* Tier 2 */}
          <button
            type="button" data-testid="restrictions-toggle"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-3 pt-3 border-t text-left"
          >
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <ShieldCheck className="size-3.5 text-muted-foreground" />
              Restrictions and expiry
              <Badge variant="secondary" className="text-[10px] font-medium">{count === 0 ? 'none set' : `${count} set`}</Badge>
            </span>
            <ChevronDown className={`size-3.5 text-muted-foreground transition-transform motion-reduce:transition-none ${advancedOpen ? 'rotate-180' : ''}`} />
          </button>

          {advancedOpen && (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">All optional. Each group answers one question about the key.</p>

              <Group question="Where can it reach?" state={`${anchored ? (workspaces.find((w) => w.id === draft.workspaceId)?.name ?? 'one workspace') : 'whole account'} · ${draft.protocolMode === 'some' && draft.surfaces.size > 0 ? `${draft.surfaces.size} protocol${draft.surfaces.size === 1 ? '' : 's'}` : 'all protocols'}`} defaultOpen>
                <div>
                  <p className="text-xs font-medium mb-1.5">Protocols</p>
                  <RadioGroup value={draft.protocolMode} onValueChange={(v) => set('protocolMode', v === 'some' ? 'some' : 'all')} aria-label="Protocols" className="gap-1.5">
                    <OptionCard testId="protocols-all" selected={draft.protocolMode === 'all'}>
                      <RadioGroupItem value="all" className="mt-0.5" />
                      <span><span className="block text-[13px] font-medium leading-5">All protocols</span><span className="block text-[11px] text-muted-foreground">REST API, WebDAV, SFTP and the S3 gateway.</span></span>
                    </OptionCard>
                    <OptionCard testId="protocols-some" selected={draft.protocolMode === 'some'}>
                      <RadioGroupItem value="some" className="mt-0.5" />
                      <span><span className="block text-[13px] font-medium leading-5">Only the ones I pick</span><span className="block text-[11px] text-muted-foreground">Everything else refuses the key.</span></span>
                    </OptionCard>
                  </RadioGroup>
                  {draft.protocolMode === 'some' && (
                    <div className="grid grid-cols-2 gap-1.5 mt-2 pl-1">
                      {SURFACE_OPTIONS.map((opt) => (
                        <label key={opt.value} className="flex items-center gap-2 text-xs cursor-pointer py-1">
                          <Checkbox className="size-4" checked={draft.surfaces.has(opt.value)} onCheckedChange={() => toggleIn('surfaces', opt.value)} />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium mb-1.5">Workspace</p>
                  <Select
                    value={draft.workspaceId}
                    onValueChange={(v) => setDraft((d) => ({ ...d, workspaceId: (v as string) ?? WHOLE_ACCOUNT, folderId: null, folderName: '' }))}
                    items={[{ value: WHOLE_ACCOUNT, label: 'Whole account' }, ...workspaces.map((w) => ({ value: w.id, label: w.name }))]}
                  >
                    <SelectTrigger className="w-full h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={WHOLE_ACCOUNT}>Whole account</SelectItem>
                      {workspaces.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground mt-1">Pin the key to one workspace, then optionally to one folder inside it.</p>
                </div>
                {anchored && (
                  <div>
                    <p className="text-xs font-medium mb-1.5">Folder</p>
                    {draft.folderId ? (
                      <div className="flex items-center gap-2">
                        <span className="flex-1 text-xs truncate border rounded-lg px-3 py-2">{draft.folderName || 'Folder'}</span>
                        <Button variant="outline" size="sm" onClick={() => setDraft((d) => ({ ...d, folderId: null, folderName: '' }))}>Clear</Button>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="w-full h-9 text-xs" onClick={() => setFolderPickerOpen(true)}>Choose folder…</Button>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-1">
                      The key only sees this folder and everything inside it, and can only be used over WebDAV or the S3 gateway.
                    </p>
                  </div>
                )}
              </Group>

              <Group question="Where can it be used from?" state={[draft.allowedIps.trim() ? 'IP-restricted' : 'anywhere', draft.hoursEnabled ? 'set hours' : 'any time'].join(', ')}>
                <div>
                  <label htmlFor={ids.ips} className="text-xs font-medium block mb-1.5">Allowed IP ranges</label>
                  <Textarea
                    id={ids.ips} data-testid="create-ips" placeholder="203.0.113.0/24, 2001:db8::/32"
                    value={draft.allowedIps} className="text-sm font-mono min-h-[3.5rem]"
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set('allowedIps', e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Comma-separated. Requests from anywhere else are refused.{' '}
                    <span className="text-amber-700 dark:text-amber-400">SFTP stops working on this key</span> - that server connects on your behalf, so your address can't be checked.
                  </p>
                </div>
                <div>
                  <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                    <Checkbox className="size-4" checked={draft.hoursEnabled} onCheckedChange={() => set('hoursEnabled', !draft.hoursEnabled)} />
                    Only during a weekly window
                  </label>
                  {draft.hoursEnabled && (
                    <div className="space-y-2 rounded-lg border p-2.5 mt-2">
                      <Select value={draft.tz} onValueChange={(v) => set('tz', String(v))} items={timezoneOptions().map((tz) => ({ value: tz, label: tz }))}>
                        <SelectTrigger className="w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {timezoneOptions().map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <div className="flex flex-wrap gap-2">
                        {DAY_OPTIONS.map((d) => (
                          <label key={d.value} className="flex items-center gap-1 text-[11px] cursor-pointer">
                            <Checkbox className="size-3.5" checked={draft.days.has(d.value)} onCheckedChange={() => toggleIn('days', d.value)} />
                            {d.label}
                          </label>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <Input type="time" aria-label="From" value={draft.from} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('from', e.target.value)} className="h-8 text-xs flex-1" />
                        <span className="text-[11px] text-muted-foreground">to</span>
                        <Input type="time" aria-label="To" value={draft.to} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('to', e.target.value)} className="h-8 text-xs flex-1" />
                      </div>
                    </div>
                  )}
                </div>
              </Group>

              <Group question="How much can it use?" state={[draft.requestsPerMinute, draft.egressGbPerDay, draft.maxFileSizeMb, draft.maxConcurrentTransfers].some((v) => v.trim()) ? 'limited' : 'no limits'}>
                <p className="text-[11px] text-muted-foreground -mt-1">Blank means unlimited. Each applies across every protocol the key can use.</p>
                <div className="grid grid-cols-2 gap-2">
                  <LimitField id={ids.rpm} label="Requests / minute" value={draft.requestsPerMinute} onChange={(v) => set('requestsPerMinute', v)} placeholder="unlimited" step="1" />
                  <LimitField id={ids.egress} label="Download / day (GB)" value={draft.egressGbPerDay} onChange={(v) => set('egressGbPerDay', v)} placeholder="unlimited" step="any" />
                  <LimitField id={ids.fsize} label="Max file size (MB)" value={draft.maxFileSizeMb} onChange={(v) => set('maxFileSizeMb', v)} placeholder="unlimited" step="any" />
                  <LimitField id={ids.conc} label="Concurrent transfers" value={draft.maxConcurrentTransfers} onChange={(v) => set('maxConcurrentTransfers', v)} placeholder="unlimited" step="1" />
                </div>
              </Group>

              <Group question="When should it stop working?" state={EXPIRY_OPTIONS.find((o) => o.value === draft.expiry)?.label.toLowerCase() ?? ''}>
                <RadioGroup value={draft.expiry} onValueChange={(v) => set('expiry', v as KeyDraft['expiry'])} aria-label="Expiry" className="gap-1.5">
                  {EXPIRY_OPTIONS.map((o) => (
                    <OptionCard key={o.value} testId={`expiry-${o.value}`} selected={draft.expiry === o.value}>
                      <RadioGroupItem value={o.value} className="mt-0.5" />
                      <span>
                        <span className="block text-[13px] font-medium leading-5">{o.label}</span>
                        {o.blurb && <span className="block text-[11px] text-muted-foreground">{o.blurb}</span>}
                      </span>
                    </OptionCard>
                  ))}
                </RadioGroup>
              </Group>
            </div>
          )}

          {/* The read-back */}
          <div className="rounded-lg bg-muted px-3 py-2.5 space-y-2">
            <p className="text-xs leading-relaxed" data-testid="create-summary">
              {describeDraft(draft, workspaces).map((s, i) => s.strong ? <b key={i} className="font-semibold">{s.text}</b> : <span key={i}>{s.text}</span>)}
            </p>
            <div className="flex flex-wrap gap-1.5" aria-label="Guards">
              {guards.map((g) => (
                <span
                  key={g.id}
                  className={`inline-flex items-center gap-1 text-[10px] font-medium rounded-md px-1.5 py-0.5 ${g.on ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-400' : 'bg-background text-muted-foreground'}`}
                >
                  <span aria-hidden className={`size-1.5 rounded-full ${g.on ? 'bg-current' : 'bg-muted-foreground/40'}`} />
                  {g.label}{g.on ? '' : ' off'}
                </span>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button data-testid="create-submit" onClick={submit} disabled={creating}>
            {creating ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null} Generate key
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Reuses the same dialog the move-file flow uses (see files.tsx). */}
      {folderPickerOpen && anchored && (
        <FolderPickerDialog
          open
          onClose={() => setFolderPickerOpen(false)}
          workspaceId={draft.workspaceId}
          selectedId={draft.folderId}
          selectedName={draft.folderName}
          onSelect={(id, name) => { setDraft((d) => ({ ...d, folderId: id, folderName: name })); setFolderPickerOpen(false); }}
          title="Limit key to a folder"
          confirmLabel="Select folder"
        />
      )}
    </Dialog>
  );
}

function OptionCard({ testId, selected, children }: { testId: string; selected: boolean; children: React.ReactNode }) {
  return (
    <label
      data-testid={testId}
      className={`grid grid-cols-[16px_1fr] gap-2.5 items-start rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${selected ? 'border-foreground bg-muted/50' : 'hover:border-ring'}`}
    >
      {children}
    </label>
  );
}

function Group({ question, state, defaultOpen, children }: { question: string; state: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border" open={defaultOpen}>
      <summary className="flex items-center justify-between gap-3 px-3 py-2.5 cursor-pointer list-none text-[12.5px] font-medium hover:bg-muted/50 rounded-lg group-open:rounded-b-none group-open:border-b [&::-webkit-details-marker]:hidden">
        {question}
        <Badge variant="secondary" className="text-[10px] font-medium shrink-0">{state}</Badge>
      </summary>
      <div className="p-3 space-y-3">{children}</div>
    </details>
  );
}

function LimitField({ id, label, value, onChange, placeholder, step }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder: string; step: string }) {
  return (
    <div>
      <label htmlFor={id} className="text-[11px] text-muted-foreground block mb-1">{label}</label>
      <Input id={id} type="number" min="1" step={step} placeholder={placeholder} value={value} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} className="h-8 text-xs" />
    </div>
  );
}
