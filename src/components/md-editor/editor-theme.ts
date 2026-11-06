// CodeMirror's look for the Markdown/text editor, built only from the app's
// theme variables (--background, --foreground, --border, ...) so it follows
// every theme in light and dark without knowing which one is active: the
// values are CSS variable references, resolved by the browser at paint time.
// One theme therefore serves both modes; nothing here is a fixed color.
//
// Logical properties only (border-inline-end, padding-inline): in a
// right-to-left UI the gutter sits on the right, and the src/ RTL gate holds
// this file to the same rule as the rest of the app.
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/** Markdown punctuation (#, **, -, >, backticks): present but quiet. */
const MARKUP = 'color-mix(in oklab, var(--muted-foreground) 70%, var(--background))';

export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    fontSize: '13px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.75',
    overflow: 'auto',
  },
  '.cm-content': {
    caretColor: 'var(--foreground)',
    padding: '16px 0',
  },
  '.cm-line': { padding: '0 16px' },
  // CodeMirror draws the caret as a one-sided border; only its color changes.
  '.cm-cursor, .cm-dropCursor': { borderColor: 'var(--foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in oklab, var(--ring) 35%, transparent)',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in oklab, var(--muted) 55%, transparent)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--background)',
    color: 'var(--muted-foreground)',
    border: 'none',
    borderInlineEnd: '1px solid var(--border)',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
  },
  '.cm-lineNumbers .cm-gutterElement': { paddingInline: '12px 10px', minWidth: '40px' },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--foreground)',
  },

  // ── Find and replace panel (@codemirror/search) ──
  '.cm-panels': {
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  // The close button sits in the end corner, so the end side keeps room for it.
  '.cm-panel.cm-search': {
    paddingBlock: '6px',
    paddingInline: '12px 40px',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
    margin: '3px 0',
    marginInlineEnd: '6px',
    verticalAlign: 'middle',
  },
  '.cm-textfield': {
    height: '28px',
    minWidth: '180px',
    padding: '0 8px',
    borderRadius: '6px',
    border: '1px solid var(--input)',
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    outline: 'none',
  },
  '.cm-textfield:focus': {
    borderColor: 'var(--ring)',
    boxShadow: '0 0 0 2px color-mix(in oklab, var(--ring) 40%, transparent)',
  },
  '.cm-button': {
    height: '28px',
    padding: '0 10px',
    borderRadius: '6px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--background)',
    backgroundImage: 'none',
    color: 'var(--foreground)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  '.cm-button:hover': { backgroundColor: 'var(--muted)' },
  '.cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--muted)' },
  '.cm-button:focus-visible': { outline: '2px solid color-mix(in oklab, var(--ring) 50%, transparent)' },
  '.cm-panel.cm-search label': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    color: 'var(--muted-foreground)',
    fontSize: '12px',
  },
  '.cm-panel.cm-search input[type=checkbox]': { margin: 0, marginInlineEnd: 0, accentColor: 'var(--primary)' },
  '.cm-panel.cm-search [name=close]': {
    color: 'var(--muted-foreground)',
    fontSize: '18px',
    lineHeight: '1',
    padding: '4px 6px',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  '.cm-panel.cm-search [name=close]:hover': { backgroundColor: 'var(--muted)', color: 'var(--foreground)' },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in oklab, var(--warning) 30%, transparent)',
    outline: 'none',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in oklab, var(--warning) 60%, transparent)',
    outline: '1px solid var(--warning)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'color-mix(in oklab, var(--ring) 18%, transparent)',
  },
  '.cm-searchMatch .cm-selectionMatch': { backgroundColor: 'transparent' },
  '.cm-textfield::placeholder': { color: 'var(--muted-foreground)' },
});

export const markdownHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700', color: 'var(--foreground)' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--primary)', textDecoration: 'underline' },
  { tag: tags.monospace, color: 'var(--muted-foreground)' },
  { tag: tags.quote, color: 'var(--muted-foreground)' },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: MARKUP },
]));
