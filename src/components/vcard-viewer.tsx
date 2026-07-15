import { useEffect, useMemo, useState } from 'react';
import {
  Phone, Mail, MapPin, Globe, Cake, StickyNote, Building2, Copy, Check,
  Pencil, Plus, Trash2, Save, X, Search,
} from 'lucide-react';
import { api, API_BASE, apiErrorMessage } from '@/api/client';
import { toast } from '@/lib/toast';
import { colorFor, initials } from '@/lib/helpers';
import { parseVCards, serializeVCards, applyEdits, type ParsedVCard, type VPhone, type VEmail } from '@/lib/vcard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  file: { id: string; name: string; mime_type: string };
  rawUrl: string;
  workspaceId: string;
  onSaved: () => void;
}

const PHONE_TYPES = ['mobile', 'home', 'work', 'main', 'fax', 'other'];
const EMAIL_TYPES = ['home', 'work', 'other'];

export function VCardView({ file, rawUrl, workspaceId, onSaved }: Props) {
  const [cards, setCards] = useState<ParsedVCard[] | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setState('loading'); setEditing(false); setSelected(0);
    let cancelled = false;
    fetch(rawUrl, { credentials: 'include' })
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((text) => {
        if (cancelled) return;
        const parsed = parseVCards(text);
        setCards(parsed);
        setState(parsed.length ? 'ok' : 'error');
      })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [rawUrl]);

  const filtered = useMemo(() => {
    if (!cards) return [];
    const q = query.trim().toLowerCase();
    if (!q) return cards.map((c, i) => ({ c, i }));
    return cards.map((c, i) => ({ c, i })).filter(({ c }) =>
      c.fullName.toLowerCase().includes(q) ||
      c.emails.some((e) => e.value.toLowerCase().includes(q)) ||
      c.phones.some((p) => p.value.toLowerCase().includes(q)) ||
      (c.org ?? '').toLowerCase().includes(q));
  }, [cards, query]);

  if (state === 'loading') {
    return <div className="text-sm text-muted-foreground">Loading contact…</div>;
  }
  if (state === 'error' || !cards) {
    return (
      <div className="bg-background border rounded-xl p-10 text-center min-w-70">
        <p className="text-4xl font-bold text-muted-foreground/30 tracking-wider mb-3">VCF</p>
        <p className="text-sm text-muted-foreground break-all">{file.name}</p>
        <p className="text-xs text-muted-foreground mt-2">This contact file couldn't be read.</p>
      </div>
    );
  }

  const card = cards[selected];
  const multi = cards.length > 1;

  const handleSaved = (edited: ParsedVCard) => {
    setCards((prev) => (prev ? prev.map((c, i) => (i === selected ? edited : c)) : prev));
    setEditing(false);
  };

  const save = async (edits: { fullName: string; phones: VPhone[]; emails: VEmail[] }) => {
    const edited = applyEdits(card, edits);
    const nextCards = cards.map((c, i) => (i === selected ? edited : c));
    const text = serializeVCards(nextCards);
    const blob = new Blob([text], { type: 'text/vcard' });
    const init = await api<{ ok: boolean; session_id?: string; error?: string }>('/api/upload/init', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: workspaceId,
        file_id: file.id,
        file_name: file.name,
        file_size: blob.size,
        mime_type: 'text/vcard',
      }),
    });
    if (!init.ok || !init.session_id) { toast.error('Save failed', init.error ?? 'Could not start upload'); return; }
    const put = await fetch(`${API_BASE}/api/upload/${init.session_id}`, {
      method: 'PUT', headers: { 'Content-Type': 'text/vcard' }, body: blob,
    });
    const putData = await put.json() as { ok: boolean; error?: string };
    if (!put.ok || !putData.ok) { toast.error('Save failed', putData.error ?? 'Failed to save'); return; }
    toast.success('Saved', 'Contact saved as new version.');
    handleSaved(edited);
    onSaved();
  };

  return (
    <div className="w-full h-full flex gap-4 self-stretch min-h-0">
      {multi && (
        <div className="w-60 shrink-0 border rounded-xl bg-background flex flex-col overflow-hidden">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search contacts" className="h-8 pl-8 text-xs" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5">
            {filtered.map(({ c, i }) => (
              <button
                key={i}
                onClick={() => { setSelected(i); setEditing(false); }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${i === selected ? 'bg-muted' : 'hover:bg-muted/50'}`}
              >
                <Avatar card={c} px={28} />
                <span className="text-xs font-medium truncate">{c.fullName || '(no name)'}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No matches</p>}
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-md mx-auto">
          {editing
            ? <ContactEditor key={selected} card={card} onCancel={() => setEditing(false)} onSave={save} />
            : <ContactCard card={card} onEdit={() => setEditing(true)} />}
        </div>
      </div>
    </div>
  );
}

// ── Avatar ─────────────────────────────────────────────────
// Size is inline (not a Tailwind `size-N` class) because Tailwind can't generate
// classes from a template literal.
function Avatar({ card, px }: { card: ParsedVCard; px: number }) {
  const box = { width: px, height: px };
  if (card.photo) return <img src={card.photo.dataUrl} alt="" style={box} className="rounded-full shrink-0 object-cover" />;
  const color = colorFor(card.fullName || 'contact');
  return (
    <div className="rounded-full shrink-0 flex items-center justify-center font-semibold text-white" style={{ ...box, background: color, fontSize: px * 0.4 }}>
      {initials(card.fullName)}
    </div>
  );
}

// ── Read-only card ─────────────────────────────────────────
function ContactCard({ card, onEdit }: { card: ParsedVCard; onEdit: () => void }) {
  return (
    <div className="border rounded-2xl bg-background overflow-hidden">
      <div className="flex flex-col items-center text-center gap-2 p-6 pb-5 bg-muted/30 relative">
        <button onClick={onEdit} className="absolute top-3 right-3 h-8 px-2.5 rounded-md border bg-background flex items-center gap-1.5 text-xs font-medium hover:bg-muted">
          <Pencil className="size-3 text-muted-foreground" /> Edit
        </button>
        <Avatar card={card} px={80} />
        <div>
          <h2 className="text-lg font-semibold">{card.fullName || '(no name)'}</h2>
          {(card.title || card.org) && (
            <p className="text-sm text-muted-foreground">
              {[card.title, card.org].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>

      <div className="p-4 space-y-1">
        {card.phones.map((p, i) => (
          <FieldRow key={`p${i}`} icon={<Phone className="size-4" />} type={p.type} value={p.value} href={`tel:${p.value.replace(/\s/g, '')}`} />
        ))}
        {card.emails.map((e, i) => (
          <FieldRow key={`e${i}`} icon={<Mail className="size-4" />} type={e.type} value={e.value} href={`mailto:${e.value}`} />
        ))}
        {card.addresses.map((a, i) => (
          <FieldRow key={`a${i}`} icon={<MapPin className="size-4" />} type={a.type} value={a.value} href={`https://maps.google.com/?q=${encodeURIComponent(a.value)}`} />
        ))}
        {card.urls.map((u, i) => (
          <FieldRow key={`u${i}`} icon={<Globe className="size-4" />} type="url" value={u} href={/^https?:\/\//.test(u) ? u : `https://${u}`} external />
        ))}
        {card.org && !card.title && (
          <FieldRow icon={<Building2 className="size-4" />} type="organization" value={card.org} />
        )}
        {card.birthday && (
          <FieldRow icon={<Cake className="size-4" />} type="birthday" value={card.birthday} />
        )}
        {card.note && (
          <div className="flex gap-3 px-2 py-2.5">
            <StickyNote className="size-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-sm whitespace-pre-wrap break-words">{card.note}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FieldRow({ icon, type, value, href, external }: { icon: React.ReactNode; type: string; value: string; href?: string; external?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {});
  };
  return (
    <div className="group flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-muted/50">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground capitalize leading-none mb-0.5">{type}</p>
        {href
          ? <a href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} className="text-sm text-primary hover:underline break-all">{value}</a>
          : <p className="text-sm break-all">{value}</p>}
      </div>
      <button onClick={copy} title="Copy" className="opacity-0 group-hover:opacity-100 transition-opacity size-7 rounded-md flex items-center justify-center hover:bg-muted shrink-0">
        {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5 text-muted-foreground" />}
      </button>
    </div>
  );
}

// ── Editor (basics: name, phones, emails) ──────────────────
function ContactEditor({ card, onCancel, onSave }: {
  card: ParsedVCard;
  onCancel: () => void;
  onSave: (edits: { fullName: string; phones: VPhone[]; emails: VEmail[] }) => Promise<void>;
}) {
  const [fullName, setFullName] = useState(card.fullName);
  const [phones, setPhones] = useState<VPhone[]>(card.phones.length ? card.phones : [{ type: 'mobile', value: '' }]);
  const [emails, setEmails] = useState<VEmail[]>(card.emails.length ? card.emails : [{ type: 'home', value: '' }]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({
        fullName: fullName.trim(),
        phones: phones.filter((p) => p.value.trim()),
        emails: emails.filter((e) => e.value.trim()),
      });
    } catch (err) {
      toast.error('Save failed', apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border rounded-2xl bg-background p-5 space-y-5">
      <div>
        <label className="text-xs font-medium text-muted-foreground">Name</label>
        <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1" placeholder="Full name" />
      </div>

      <EditList
        label="Phone"
        icon={<Phone className="size-3.5" />}
        rows={phones}
        types={PHONE_TYPES}
        placeholder="Phone number"
        onChange={setPhones}
        emptyRow={{ type: 'mobile', value: '' }}
      />
      <EditList
        label="Email"
        icon={<Mail className="size-3.5" />}
        rows={emails}
        types={EMAIL_TYPES}
        placeholder="email@example.com"
        onChange={setEmails}
        emptyRow={{ type: 'home', value: '' }}
      />

      <p className="text-[11px] text-muted-foreground">Other fields (address, organization, notes, photo…) are preserved unchanged.</p>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}><X className="size-3.5 mr-1.5" /> Cancel</Button>
        <Button size="sm" onClick={submit} disabled={saving}><Save className="size-3.5 mr-1.5" /> {saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  );
}

function EditList({ label, icon, rows, types, placeholder, onChange, emptyRow }: {
  label: string;
  icon: React.ReactNode;
  rows: { type: string; value: string }[];
  types: string[];
  placeholder: string;
  onChange: (rows: { type: string; value: string }[]) => void;
  emptyRow: { type: string; value: string };
}) {
  const set = (i: number, patch: Partial<{ type: string; value: string }>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">{icon} {label}</div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={types.includes(r.type) ? r.type : 'other'}
              onChange={(e) => set(i, { type: e.target.value })}
              className="h-9 rounded-md border bg-background px-2 text-xs shrink-0"
            >
              {types.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
            </select>
            <Input value={r.value} onChange={(e) => set(i, { value: e.target.value })} placeholder={placeholder} className="flex-1" />
            <button onClick={() => onChange(rows.filter((_, idx) => idx !== i))} title="Remove" className="size-9 rounded-md flex items-center justify-center hover:bg-muted text-muted-foreground shrink-0">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        <button onClick={() => onChange([...rows, { ...emptyRow }])} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
          <Plus className="size-3.5" /> Add {label.toLowerCase()}
        </button>
      </div>
    </div>
  );
}
