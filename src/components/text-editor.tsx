import { useEffect, useRef, useState } from 'react';
import { X, Save } from 'lucide-react';
import { api, API_BASE } from '@/api/client';
import { apiErrorMessage } from '@/api/client';
import { toast } from '@/lib/toast';
import { langFromExtension } from '@/lib/text-detect';
import { t, useT } from '@/lib/i18n';

// Prose files get a direction per line; everything else is code and reads left to right.
const PROSE_LANGS = new Set(['text', 'markdown']);

interface Props {
  file: { id: string; name: string; mime_type: string };
  rawUrl: string;
  workspaceId: string;
  onClose: () => void;
  onSaved: () => void;
}

// Canonical lang → dynamic CodeMirror language extension loader.
async function loadLanguage(lang: string) {
  switch (lang) {
    case 'typescript': case 'tsx': return (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: lang === 'tsx' });
    case 'javascript': case 'jsx': return (await import('@codemirror/lang-javascript')).javascript({ jsx: lang === 'jsx' });
    case 'python': return (await import('@codemirror/lang-python')).python();
    case 'json': case 'jsonc': return (await import('@codemirror/lang-json')).json();
    case 'markdown': return (await import('@codemirror/lang-markdown')).markdown();
    case 'css': case 'scss': case 'less': return (await import('@codemirror/lang-css')).css();
    case 'html': case 'vue': case 'svelte': return (await import('@codemirror/lang-html')).html();
    case 'sql': return (await import('@codemirror/lang-sql')).sql();
    case 'yaml': return (await import('@codemirror/lang-yaml')).yaml();
    case 'rust': return (await import('@codemirror/lang-rust')).rust();
    case 'go': return (await import('@codemirror/lang-go')).go();
    default: return null;
  }
}

export function TextEditorOverlay({ file, rawUrl, workspaceId, onClose, onSaved }: Props) {
  const tr = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<import('@codemirror/view').EditorView | null>(null);
  const [saving, setSaving] = useState(false);
  const [initialRawUrl] = useState(rawUrl); // freeze at mount - later editorRawUrl churn must not rebuild the editor and drop edits

  // Keep keystrokes typed in the editor from bubbling to the document-level
  // shortcut handler in files.tsx (which otherwise treats them as list
  // actions - e.g. Ctrl/Cmd+A select-all - while the user is typing here).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: KeyboardEvent) => e.stopPropagation();
    el.addEventListener('keydown', stop);
    return () => el.removeEventListener('keydown', stop);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const text = await fetch(initialRawUrl, { credentials: 'include' }).then((r) => (r.ok ? r.text() : Promise.reject()));
        if (cancelled || !containerRef.current) return;
        const { EditorView, basicSetup } = await import('codemirror');
        const { oneDark } = await import('@codemirror/theme-one-dark');
        const langExt = await loadLanguage(langFromExtension(file.name));
        if (cancelled || !containerRef.current) return;
        const extensions = [basicSetup, oneDark, EditorView.lineWrapping];
        if (langExt) extensions.push(langExt);
        const lang = langFromExtension(file.name);
        if (PROSE_LANGS.has(lang)) extensions.push(EditorView.perLineTextDirection.of(true));
        else containerRef.current.dir = 'ltr';
        viewRef.current = new EditorView({
          doc: text,
          extensions,
          parent: containerRef.current,
        });
      } catch {
        toast.error(t('common.error.editorUnavailable'), t('common.error.couldNotOpenTheTextEditor'));
        onClose();
      }
    })();
    return () => { cancelled = true; viewRef.current?.destroy(); viewRef.current = null; };
  }, [initialRawUrl, file.name, onClose]);

  const save = async () => {
    const view = viewRef.current;
    if (!view || saving) return;
    setSaving(true);
    try {
      const content = view.state.doc.toString();
      const blob = new Blob([content], { type: file.mime_type || 'text/plain' });
      const init = await api<{ ok: boolean; session_id?: string; error?: string }>('/api/upload/init', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: workspaceId,
          file_id: file.id,
          file_name: file.name,
          file_size: blob.size,
          mime_type: file.mime_type || 'text/plain',
        }),
      });
      if (!init.ok || !init.session_id) { toast.error(t('common.error.saveFailed'), init.error ?? t('common.error.couldNotStartUpload')); setSaving(false); return; }
      const put = await fetch(`${API_BASE}/api/upload/${init.session_id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': file.mime_type || 'text/plain' },
        body: blob,
      });
      const putData = await put.json() as { ok: boolean; error?: string };
      if (!put.ok || !putData.ok) { toast.error(t('common.error.saveFailed'), putData.error ?? t('common.error.failedToSave')); setSaving(false); return; }
      toast.success(t('common.feedback.saved'), t('common.feedback.fileSavedAsNewVersion'));
      onSaved();
      onClose();
    } catch (err) {
      toast.error(t('common.error.saveFailed'), apiErrorMessage(err));
      setSaving(false);
    }
  };

  return (
    <div ref={rootRef} className="fixed inset-0 z-[1000] bg-background flex flex-col animate-slide-up">
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
        <div className="flex items-center gap-2 text-sm font-semibold truncate">{file.name}</div>
        <div className="flex items-center gap-1">
          <button onClick={save} disabled={saving}
            className="h-7 px-2.5 rounded-md border flex items-center gap-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
            <Save className="size-3" /> {saving ? tr('common.status.saving') : tr('common.action.saveVersion')}
          </button>
          <button onClick={onClose} className="size-8 rounded-md flex items-center justify-center hover:bg-muted" title={tr('common.close')}>
            <X className="size-4 text-muted-foreground" />
          </button>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 overflow-auto [&_.cm-editor]:h-full" />
    </div>
  );
}
