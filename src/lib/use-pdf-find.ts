import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// Document-wide text search over a pdf.js document. Matches are page-granular:
// the viewer jumps to the page holding each hit (no glyph-level highlight,
// which would need pdf.js's full text layer).
export function usePdfFind(doc: PDFDocumentProxy | null, onJump: (page: number) => void) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // One entry per match, valued with the page number that holds it.
  const [matches, setMatches] = useState<number[]>([]);
  const [current, setCurrent] = useState(0);
  const textCache = useRef(new Map<number, string>());
  const scanToken = useRef(0);
  // Latest-ref for the jump callback: the viewer recreates it every render,
  // and depending on it directly would restart the scan effect each time.
  const onJumpRef = useRef(onJump);
  useEffect(() => { onJumpRef.current = onJump; });

  useEffect(() => {
    textCache.current.clear();
  }, [doc]);

  // Clearing happens in the query handler below, not the effect - the effect
  // only owns the async scan whose results land in setState callbacks.
  const changeQuery = (value: string) => {
    setQuery(value);
    if (!value.trim()) {
      setMatches([]);
      setCurrent(0);
    }
  };

  useEffect(() => {
    const token = ++scanToken.current;
    const q = query.trim().toLowerCase();
    if (!doc || !q) return;
    (async () => {
      const found: number[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        let text = textCache.current.get(n);
        if (text === undefined) {
          const page = await doc.getPage(n);
          const content = await page.getTextContent();
          text = content.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' ')
            .toLowerCase();
          textCache.current.set(n, text);
        }
        if (scanToken.current !== token) return;
        let idx = text.indexOf(q);
        while (idx !== -1) {
          found.push(n);
          idx = text.indexOf(q, idx + q.length);
        }
      }
      if (scanToken.current !== token) return;
      setMatches(found);
      setCurrent(0);
      if (found.length) onJumpRef.current(found[0]);
    })();
  }, [doc, query]);

  const step = (dir: 1 | -1) => {
    if (!matches.length) return;
    const next = (current + dir + matches.length) % matches.length;
    setCurrent(next);
    onJumpRef.current(matches[next]);
  };

  return {
    open,
    show: () => setOpen(true),
    hide: () => setOpen(false),
    query,
    setQuery: changeQuery,
    total: matches.length,
    current,
    next: () => step(1),
    prev: () => step(-1),
  };
}

export type PdfFind = ReturnType<typeof usePdfFind>;
