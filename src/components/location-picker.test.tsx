import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LocationPicker, type RegionInfo } from './location-picker';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

const REGIONS: RegionInfo[] = [
  { code: 'ap-southeast-2', city: 'Sydney', country: 'Australia', continent: 'Oceania', flag: '\u{1F1E6}\u{1F1FA}' },
  { code: 'eu-west-1', city: 'Dublin', country: 'Ireland', continent: 'Europe' },
  { code: 'eu-central-1', city: 'Frankfurt', country: 'Germany', continent: 'Europe' },
];

function render(value: string, onChange: (code: string) => void = () => {}, regions: RegionInfo[] = REGIONS) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<LocationPicker regions={regions} value={value} onChange={onChange} />); });
}

const options = () => [...container!.querySelectorAll('[role="option"]')] as HTMLButtonElement[];
const codes = () => options().map((o) => o.textContent ?? '');

function search(text: string) {
  const input = container!.querySelector('input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// A workspace's location is chosen once, at creation. The picker is the only
// place that choice is offered, so it has to make 40-odd locations findable.
describe('LocationPicker', () => {
  it('groups the locations by continent, in the order the server sent them', () => {
    render('');
    const groups = [...container!.querySelectorAll('[role="group"]')];
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Oceania', 'Europe']);
    // Every region is offered, each under its own continent.
    expect(options()).toHaveLength(3);
    expect(codes()[0]).toContain('Sydney');
    expect(codes()[1]).toContain('Dublin');
  });

  // A listbox may own only options and groups. A bare wrapper div lets
  // assistive tech drop the relationship and announce an empty list, and the
  // visual continent heading would be read as a stray string beside the
  // options - so the heading is hidden and the wrapper carries the name.
  it('lets the listbox own groups and options, and nothing else', () => {
    render('');
    const listbox = container!.querySelector('[role="listbox"]') as HTMLElement;
    expect(listbox.getAttribute('aria-label')).toBe('Location');
    for (const group of [...listbox.children]) {
      expect(group.getAttribute('role')).toBe('group');
      // The visible heading duplicates the group's own accessible name.
      expect(group.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
      expect(group.firstElementChild!.textContent).toBe(group.getAttribute('aria-label'));
    }
  });

  it('filters by city, by country and by code', () => {
    render('');
    search('frank');
    expect(options()).toHaveLength(1);
    expect(codes()[0]).toContain('Frankfurt');

    search('ireland');
    expect(options()).toHaveLength(1);
    expect(codes()[0]).toContain('Dublin');

    search('ap-southeast');
    expect(options()).toHaveLength(1);
    expect(codes()[0]).toContain('Sydney');
  });

  it('says so when nothing matches, rather than showing an empty box', () => {
    render('');
    search('atlantis');
    expect(options()).toHaveLength(0);
    expect(container!.textContent).toContain('No location matches.');
  });

  // "No location matches." is a search result. An empty list is not a search
  // result - it means there was nothing to search - and telling a user whose
  // fetch failed that their query matched nothing sends them hunting for a
  // typo they did not make.
  it('distinguishes an empty list from a search that matched nothing', () => {
    render('', () => {}, []);
    expect(options()).toHaveLength(0);
    expect(container!.textContent).toContain('No locations available.');
    expect(container!.textContent).not.toContain('No location matches.');
  });

  it('calls onChange with the code of the location clicked', () => {
    const onChange = vi.fn();
    render('', onChange);
    act(() => { options()[2].click(); });
    expect(onChange).toHaveBeenCalledWith('eu-central-1');
  });

  it('marks the current value as the selected option', () => {
    render('eu-west-1');
    const selected = options().filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain('Dublin');
  });
});
