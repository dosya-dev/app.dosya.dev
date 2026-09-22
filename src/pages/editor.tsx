import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, Download } from 'lucide-react';
import { api, apiErrorMessage, API_BASE } from '@/api/client';
import { useDocumentTitle } from '@/lib/page-title';

interface EditorConfigResponse {
  ok: boolean;
  documentServerUrl: string;
  config: {
    documentType: string;
    type: string;
    document: {
      fileType: string;
      key: string;
      title: string;
      url: string;
      permissions: { edit: boolean };
    };
    editorConfig: { mode: 'edit' | 'view'; callbackUrl?: string };
    token: string;
  };
}

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (elementId: string, config: unknown) => { destroyEditor?: () => void };
    };
  }
}

/** The shape ONLYOFFICE hands to `events.onError` / `events.onWarning`. */
interface DocsApiEvent {
  data?: { errorCode?: number; errorDescription?: string } | string;
}

/**
 * Codes that mean the document never opened: conversion, download, token and
 * licence failures. Only these earn the full-surface card - it is
 * `absolute inset-0` and swallows every click meant for the editor, so
 * showing it for a recoverable error (an unrecognised code, a transient
 * co-editing complaint) makes a perfectly working editor unusable. Anything
 * outside this set is reported as a dismissible notice instead.
 */
const FATAL_EDITOR_ERROR_CODES = new Set([-1, -2, -3, -4, -5, -6, -7, -8, -20, -21]);

export function isFatalEditorError(e: DocsApiEvent | undefined): boolean {
  return typeof errorCodeOf(e) === 'number' && FATAL_EDITOR_ERROR_CODES.has(errorCodeOf(e)!);
}

function errorCodeOf(e: DocsApiEvent | undefined): number | undefined {
  const data = e?.data;
  return typeof data === 'object' && data ? data.errorCode : undefined;
}

/**
 * A sentence for the editor's own error event. ONLYOFFICE's descriptions are
 * written for integrators ("Download failed" means the document server could
 * not fetch the file from us); the codes that matter to a reader get their
 * own wording, the rest fall back to a generic line.
 */
export function describeEditorError(e: DocsApiEvent | undefined): string {
  const lead = 'The document editor could not be loaded';
  switch (errorCodeOf(e)) {
    case -4: return `${lead} - the document server could not fetch this file. You can still preview or download it.`;
    case -2: return `${lead} - the document server could not be reached.`;
    case -20: return `${lead} - the document server has no free editing seats right now.`;
    case -21: return `${lead} - the document server is not licensed for editing.`;
    default: return `${lead}.`;
  }
}

/**
 * Copy for a NON-fatal error. It must not borrow the fatal sentence: the
 * editor did load, it is on screen behind the notice, and telling someone
 * their working editor "could not be loaded" is simply false.
 */
export function describeEditorNotice(e: DocsApiEvent | undefined): string {
  const code = errorCodeOf(e);
  return code === undefined
    ? 'The document editor reported a problem. If it stops responding, reload the page.'
    : `The document editor reported a problem (code ${code}). If it stops responding, reload the page.`;
}

const SCRIPT_ID = 'onlyoffice-docsapi';

function loadDocsApi(serverUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.DocsAPI) { resolve(); return; }
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');

    // Shared settle handler for both the fresh-tag and existing-tag paths.
    // A script element fires load/error only once per src, so a failed tag
    // left in the DOM would never fire again - the next loadDocsApi() call
    // would attach listeners that never settle and "Try again" would hang
    // forever. Removing the tag on error guarantees the next call finds no
    // existing tag and creates a genuinely fresh one.
    const onLoad = () => {
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      script.remove();
      reject(new Error('Document server unreachable'));
    };
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);

    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = `${serverUrl}/web-apps/apps/api/documents/api.js`;
      document.head.appendChild(script);
    }
  });
}

export default function EditorPage() {
  const { fileId } = useParams();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [title, setTitle] = useState<string | null>(null);
  // Starts unknown (not defaulted to 'view') so the read-only badge never
  // flashes before the config fetch resolves - it renders only once the
  // real mode is known, independent of whether the DocsAPI script/editor
  // has finished mounting below.
  const [mode, setMode] = useState<'edit' | 'view' | null>(null);
  const [attempt, setAttempt] = useState(0);
  // A non-fatal editor complaint: shown beside the editor, never over it.
  const [notice, setNotice] = useState<string | null>(null);

  useDocumentTitle(title);

  useEffect(() => {
    let cancelled = false;
    let editor: { destroyEditor?: () => void } | null = null;
    setState('loading');
    setError('');
    setNotice(null);
    (async () => {
      try {
        const res = await api<EditorConfigResponse>(`/api/files/${fileId}/editor-config`);
        if (cancelled) return;
        setTitle(res.config.document.title);
        setMode(res.config.editorConfig.mode);
        await loadDocsApi(res.documentServerUrl);
        if (cancelled || !window.DocsAPI) return;
        // The editor reports failures AFTER construction, through these hooks,
        // not by throwing: a server that loads api.js but cannot fetch the file
        // used to leave a blank frame under "Loading editor...". onError swaps
        // to the same error card the fetch path uses; warnings are logged
        // only, the editor keeps working after them.
        const config = {
          ...res.config,
          events: {
            onError: (e: DocsApiEvent) => {
              if (cancelled) return;
              console.error('onlyoffice: editor error', e?.data);
              // Fatal codes replace the surface; everything else - including
              // codes we do not recognise - is a notice, because the editor
              // behind it may be working perfectly well.
              if (isFatalEditorError(e)) {
                setError(describeEditorError(e));
                setState('error');
              } else {
                setNotice(describeEditorNotice(e));
              }
            },
            onWarning: (e: DocsApiEvent) => {
              // Warnings are non-critical by definition in the DocsAPI
              // contract (co-editing notices, an unsaved-changes hint), so
              // they are logged and never shown as a failure.
              console.warn('onlyoffice: editor warning', e?.data);
            },
          },
        };
        editor = new window.DocsAPI.DocEditor('oo-editor', config);
        setState('ready');
      } catch (e) {
        if (!cancelled) {
          setError(apiErrorMessage(e, 'The document editor could not be loaded.'));
          setState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      editor?.destroyEditor?.();
    };
  }, [fileId, attempt]);

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="flex items-center gap-3 px-4 py-2 border-b shrink-0">
        <Link to="/files" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Files
        </Link>
        <span className="text-sm font-medium truncate">{title ?? ''}</span>
        {mode === 'view' && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            <Eye className="size-3" /> Read-only
          </span>
        )}
      </header>
      <div className="flex-1 min-h-0 relative">
        {state === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Loading editor...
          </div>
        )}
        {/* An unrecognised code may in fact be fatal, leaving this notice over
            a blank editor - so it carries the same escapes the fatal card
            does. It still does not COVER the editor, because the far more
            likely case is that the document is fine. */}
        {state !== 'error' && notice && (
          <div
            data-testid="editor-error-notice"
            className="absolute inset-x-0 top-0 z-10 mx-auto mt-2 flex w-fit max-w-[min(90%,32rem)] flex-col gap-1.5 rounded-lg border bg-background px-3 py-2 text-xs shadow-md"
          >
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground">{notice}</span>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setNotice(null)}
                className="ml-auto font-semibold text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setAttempt((a) => a + 1)}
                className="font-medium underline underline-offset-4 hover:text-foreground"
              >
                Try again
              </button>
              <Link to={`/files?view=${fileId}`} className="inline-flex items-center gap-1 font-medium underline underline-offset-4 hover:text-foreground">
                <Eye className="size-3" /> Open preview
              </Link>
              <a href={`${API_BASE}/api/files/${fileId}/download`} className="inline-flex items-center gap-1 font-medium underline underline-offset-4 hover:text-foreground">
                <Download className="size-3" /> Download
              </a>
            </div>
          </div>
        )}
        {state === 'error' && (
          <div data-testid="editor-error-overlay" className="absolute inset-0 flex items-center justify-center">
            <div className="bg-background border rounded-xl p-8 text-center max-w-sm">
              <p className="text-sm text-muted-foreground mb-4">
                {error || 'The document editor could not be loaded.'}
              </p>
              <button
                type="button"
                onClick={() => setAttempt((a) => a + 1)}
                className="px-4 py-2 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-90"
              >
                Try again
              </button>
              {/* The document is still there even when the editor is not. */}
              <div className="mt-4 flex items-center justify-center gap-4 text-xs">
                <Link to={`/files?view=${fileId}`} className="inline-flex items-center gap-1 font-medium underline underline-offset-4 hover:text-foreground">
                  <Eye className="size-3" /> Open preview
                </Link>
                <a href={`${API_BASE}/api/files/${fileId}/download`} className="inline-flex items-center gap-1 font-medium underline underline-offset-4 hover:text-foreground">
                  <Download className="size-3" /> Download
                </a>
              </div>
            </div>
          </div>
        )}
        <div id="oo-editor" className="w-full h-full" />
      </div>
    </div>
  );
}
