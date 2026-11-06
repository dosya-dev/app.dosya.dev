// The source pane of the Markdown/text editor: CodeMirror 6, uncontrolled.
// The page talks to it through an imperative handle (read the text, replace
// it, run a toolbar command, open find) so a keystroke never round-trips
// through React state, and so page tests can stand a plain textarea in for
// it - jsdom cannot lay CodeMirror out. Ported from the desktop app's
// CodeEditor, find and replace (@codemirror/search) included.
import { useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import {
  EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  closeSearchPanel, highlightSelectionMatches, openSearchPanel, search, searchKeymap, searchPanelOpen,
} from '@codemirror/search';
import { markdown } from '@codemirror/lang-markdown';
import { formatMarkdown, type MdFormat } from '@/lib/md-format';
import { editorTheme, markdownHighlight } from './editor-theme';

export interface EditorHandle {
  getText(): string;
  /** Replace the whole document, as one undoable edit. */
  setText(text: string): void;
  format(kind: MdFormat): void;
  focus(): void;
  /** Open the find panel (or move focus back into it), on the replace field if asked. */
  openSearch(opts?: { replace?: boolean }): void;
  /** Close the find panel. False when it was not open, so Escape can mean "leave". */
  closeSearch(): boolean;
  searchOpen(): boolean;
  /** The element that scrolls, for scroll sync. */
  scroller(): HTMLElement | null;
}

export interface CodeEditorProps {
  ref?: React.Ref<EditorHandle>;
  /** Read once, at mount. Later changes go through the handle. */
  initialText: string;
  markdown: boolean;
  /** Accessible name of the text area, e.g. the file name. */
  label: string;
  /**
   * CodeMirror's own UI strings (the find panel's labels and announcements),
   * keyed by their English text as CodeMirror names them. Follows locale
   * changes live.
   */
  phrases?: Record<string, string>;
  onChange(text: string): void;
  onCursor(pos: { line: number; col: number }): void;
}

function applyFormat(view: EditorView, kind: MdFormat): boolean {
  const sel = view.state.selection.main;
  const edit = formatMarkdown(view.state.doc.toString(), sel.from, sel.to, kind);
  view.dispatch({
    changes: edit.changes,
    selection: edit.selection,
    scrollIntoView: true,
    userEvent: 'input.format',
  });
  view.focus();
  return true;
}

function openSearch(view: EditorView, replace = false): boolean {
  view.focus();
  openSearchPanel(view);
  // The panel selects its search field on mount; say so explicitly, so focus
  // lands in the bar however it was opened (and on Replace when asked).
  const field = view.dom.querySelector<HTMLInputElement>(replace ? '.cm-search input[name=replace]' : '.cm-search [main-field]');
  field?.focus();
  field?.select();
  return true;
}

/**
 * CodeMirror's find keys (Cmd+F / Ctrl+F, F3, Enter in the bar, ...), minus
 * Go to line (Mod-Alt-g): its dialog has untranslated labels of its own, and
 * the status bar already shows the line. Replace gets a key of its own,
 * Mod-Alt-f, plus Ctrl-h off macOS; the same keys as the desktop editor.
 */
const findKeys = [
  ...searchKeymap.filter((b) => b.key !== 'Mod-Alt-g'),
  { key: 'Mod-Alt-f', run: (v: EditorView) => openSearch(v, true), preventDefault: true },
  { win: 'Ctrl-h', linux: 'Ctrl-h', run: (v: EditorView) => openSearch(v, true), preventDefault: true },
];

export function CodeEditor({ ref, initialText, markdown: isMarkdown, label, phrases, onChange, onCursor }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const phrasesSlot = useRef(new Compartment());
  const callbacks = useRef({ onChange, onCursor });
  useEffect(() => { callbacks.current = { onChange, onCursor }; });

  useEffect(() => {
    if (!hostRef.current) return;
    const reportCursor = (state: EditorState) => {
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      callbacks.current.onCursor({ line: line.number, col: head - line.from + 1 });
    };
    // Mod-k is the link command here, ahead of anything else bound to it;
    // the page also keeps the keystroke from reaching the app's own Cmd+K.
    const formatting = isMarkdown
      ? [Prec.high(keymap.of([
          { key: 'Mod-b', run: (v) => applyFormat(v, 'bold') },
          { key: 'Mod-i', run: (v) => applyFormat(v, 'italic') },
          { key: 'Mod-k', run: (v) => applyFormat(v, 'link') },
        ]))]
      : [];
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          // Prose: each line takes the direction of its own text, so Arabic
          // or Hebrew lines read right to left inside an English file.
          EditorView.perLineTextDirection.of(true),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          ...formatting,
          search({ top: true }),
          highlightSelectionMatches(),
          phrasesSlot.current.of(EditorState.phrases.of(phrases ?? {})),
          keymap.of([...findKeys, ...defaultKeymap, ...historyKeymap]),
          ...(isMarkdown ? [markdown(), markdownHighlight] : []),
          editorTheme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
            if (u.docChanged || u.selectionSet) reportCursor(u.state);
          }),
        ],
      }),
    });
    viewRef.current = view;
    reportCursor(view.state);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Built once per mount: the page remounts the editor per file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: phrasesSlot.current.reconfigure(EditorState.phrases.of(phrases ?? {})) });
  }, [phrases]);

  useImperativeHandle(ref, () => ({
    getText: () => viewRef.current?.state.doc.toString() ?? '',
    setText: (text) => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: 'input.replace' });
    },
    format: (kind) => { if (viewRef.current) applyFormat(viewRef.current, kind); },
    focus: () => viewRef.current?.focus(),
    openSearch: (opts) => { if (viewRef.current) openSearch(viewRef.current, opts?.replace === true); },
    closeSearch: () => {
      const view = viewRef.current;
      if (!view || !searchPanelOpen(view.state)) return false;
      closeSearchPanel(view);
      return true;
    },
    searchOpen: () => (viewRef.current ? searchPanelOpen(viewRef.current.state) : false),
    scroller: () => viewRef.current?.scrollDOM ?? null,
  }), []);

  return <div ref={hostRef} data-testid="code-editor" className="h-full min-h-0 min-w-0" />;
}
