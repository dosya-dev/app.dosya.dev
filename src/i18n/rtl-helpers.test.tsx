import { ArrowRightLeft, ChevronRight, ExternalLink, PanelLeftClose, Undo2 } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, type ReactElement } from 'react';
import { DIRECTIONAL_ICONS, physicalClassesIn, renderInLocale, unflippedIcons } from '../../tests/helpers/i18n-sweep';

function mount(ui: ReactElement): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  act(() => createRoot(el).render(ui));
  return el;
}

describe('physicalClassesIn', () => {
  it('finds ml-2 and text-left', () => {
    const el = mount(<div className="ml-2 flex text-left" />);
    expect(physicalClassesIn(el)).toEqual(['ml-2', 'text-left']);
  });

  it('ignores logical classes and subtrees under [dir="ltr"]', () => {
    const el = mount(
      <div>
        <div className="ms-2" />
        <div dir="ltr">
          <div className="ml-2" />
        </div>
      </div>,
    );
    expect(physicalClassesIn(el)).toEqual([]);
  });

  it('ignores a centering pair but not a lone left-1/2', () => {
    const pair = mount(<div className="absolute left-1/2 -translate-x-1/2" />);
    expect(physicalClassesIn(pair)).toEqual([]);
    const lone = mount(<div className="absolute left-1/2" />);
    expect(physicalClassesIn(lone)).toEqual(['left-1/2']);
  });
});

describe('physicalClassesIn centering variants', () => {
  it('ignores md:-translate-x-1/2 pairs', () => {
    const el = mount(<div className="absolute md:left-1/2 md:-translate-x-1/2" />);
    expect(physicalClassesIn(el)).toEqual([]);
  });
});

describe('renderInLocale document state', () => {
  it('restores dir and lang on unmount', async () => {
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    const r = await renderInLocale(<div />, 'ar');
    expect(document.documentElement.dir).toBe('rtl');
    r.unmount();
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    document.documentElement.removeAttribute('lang');
    document.documentElement.removeAttribute('dir');
  });
});

describe('unflippedIcons', () => {
  it('finds a bare ChevronRight', () => {
    const el = mount(<ChevronRight />);
    expect(unflippedIcons(el)).toEqual(['lucide-chevron-right']);
  });

  it('accepts rtl:-scale-x-100, rtl:rotate-180 and an ancestor [dir="ltr"]', () => {
    const el = mount(
      <div>
        <ChevronRight className="rtl:-scale-x-100" />
        <ChevronRight className="rtl:rotate-180" />
        <div dir="ltr">
          <ChevronRight />
        </div>
      </div>,
    );
    expect(unflippedIcons(el)).toEqual([]);
  });

  it('matches panel and undo families but never external-link or arrow-right-left', () => {
    const el = mount(
      <div>
        <PanelLeftClose />
        <Undo2 />
        <ExternalLink />
        <ArrowRightLeft />
      </div>,
    );
    expect(unflippedIcons(el).sort()).toEqual(['lucide-panel-left-close', 'lucide-undo2']);
    expect(DIRECTIONAL_ICONS).toContain('lucide-chevron-left');
  });
});
