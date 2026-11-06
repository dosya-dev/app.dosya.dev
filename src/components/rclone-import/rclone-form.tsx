import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import type { RcloneBackend } from '@/api/rclone-import';
import { appliesTo, optionLabel, visibleOptions } from './form-model';

/**
 * The connection form for one rclone backend, generated from rclone's own
 * option schema (served by GET /api/rclone/backends). Option names and help
 * text are rclone's, in English, as rclone's docs show them - the user is
 * often copying values out of those docs.
 */

function AuthorizeHint({ backend }: { backend: RcloneBackend }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const cmd = `rclone authorize "${backend.name}"`;
  return (
    <div className="rounded-md border bg-muted/40 p-3 text-xs">
      <p className="mb-2 text-muted-foreground">{t('profile.description.rcloneAuthorizeHint', { label: backend.label })}</p>
      <div className="flex items-center gap-2">
        <code dir="ltr" className="flex-1 truncate rounded bg-background px-2 py-1 font-mono">{cmd}</code>
        <Button
          type="button" variant="outline" size="sm" className="shrink-0 gap-1 text-xs"
          onClick={() => { void navigator.clipboard?.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {t('common.copy')}
        </Button>
      </div>
    </div>
  );
}

export function RcloneForm({ backend, values, onChange, invalidField }: {
  backend: RcloneBackend;
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  invalidField?: string | null;
}) {
  const t = useT();
  const set = (name: string, v: string) => onChange({ ...values, [name]: v });
  const provider = values.provider;

  return (
    <div className="space-y-3">
      {backend.oauth && <AuthorizeHint backend={backend} />}
      {visibleOptions(backend, values).map((o) => {
        const id = `rclone-opt-${o.name}`;
        const examples = (o.examples ?? []).filter((e) => appliesTo(e, provider));
        const invalid = invalidField === o.name;
        if (o.type === 'bool') {
          return (
            <label key={o.name} htmlFor={id} className="flex items-start gap-2 text-sm">
              <Checkbox id={id} checked={values[o.name] === 'true'} onCheckedChange={(c) => set(o.name, c ? 'true' : '')} />
              <span>
                <span className="font-medium">{optionLabel(o.name)}</span>
                {o.help && <span className="block text-xs text-muted-foreground">{o.help}</span>}
              </span>
            </label>
          );
        }
        return (
          <div key={o.name} className="space-y-1">
            <label htmlFor={id} className="text-sm font-medium">
              {optionLabel(o.name)}{o.required && <span className="text-destructive"> *</span>}
            </label>
            {/* A provider choice decides which other fields apply, so it is a
                dropdown even where rclone would also accept a typed value. */}
            {(o.exclusive || o.name === 'provider') && examples.length > 0 ? (
              <select
                id={id}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={values[o.name] ?? ''}
                aria-invalid={invalid || undefined}
                onChange={(e) => set(o.name, e.target.value)}
              >
                <option value="">{t('profile.placeholder.rcloneChoose')}</option>
                {examples.map((e) => <option key={e.value} value={e.value}>{e.help || e.value}</option>)}
              </select>
            ) : (
              <>
                {/* A text field beside a password field looks like a login form, and
                    browsers then fill the user's saved dosya login no matter what
                    autocomplete="off" says. "new-password" is the one value they honour
                    for a secret; the data-* hints keep password managers out too. */}
                <Input
                  id={id}
                  name={id}
                  type={o.password ? 'password' : 'text'}
                  dir="ltr"
                  autoComplete={o.password ? 'new-password' : 'off'}
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore
                  data-form-type="other"
                  spellCheck={false}
                  placeholder={o.default || (examples[0]?.value ?? '')}
                  value={values[o.name] ?? ''}
                  aria-invalid={invalid || undefined}
                  list={examples.length > 0 ? `${id}-list` : undefined}
                  onChange={(e) => set(o.name, e.target.value)}
                />
                {examples.length > 0 && (
                  <datalist id={`${id}-list`}>
                    {examples.slice(0, 200).map((e) => <option key={e.value} value={e.value}>{e.help}</option>)}
                  </datalist>
                )}
              </>
            )}
            {o.help && <p className="text-xs text-muted-foreground">{o.help}</p>}
          </div>
        );
      })}
    </div>
  );
}
