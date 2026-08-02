import { describe, it, expect } from 'vitest';
import { demoReducer, initialDemoState, visibleItems, breadcrumbs, type DemoState } from './demoState';

const s0 = initialDemoState;

describe('sorting', () => {
  it('first click on name sorts ascending', () => {
    const s = demoReducer(s0, { type: 'TOGGLE_SORT', key: 'name' });
    expect(s.sort).toEqual({ key: 'name', dir: 'asc' });
    const names = visibleItems(s).files.map((f) => f.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
  it('first click on size sorts descending, second flips', () => {
    let s = demoReducer(s0, { type: 'TOGGLE_SORT', key: 'size' });
    expect(s.sort).toEqual({ key: 'size', dir: 'desc' });
    s = demoReducer(s, { type: 'TOGGLE_SORT', key: 'size' });
    expect(s.sort.dir).toBe('asc');
  });
});

describe('navigation', () => {
  it('navigate into folder shows its children and breadcrumb trail', () => {
    const s = demoReducer(s0, { type: 'NAVIGATE', folderId: 'f-projects' });
    const { folders, files } = visibleItems(s);
    expect(folders.some((f) => f.id === 'f-design')).toBe(true);
    expect(files.every((f) => f.folderId === 'f-projects')).toBe(true);
    expect(breadcrumbs(s).map((f) => f.name)).toEqual(['Projects']);
  });
});

describe('uploads', () => {
  it('runs to completion: file lands in current folder + activity row + CTA toast', () => {
    let s: DemoState = demoReducer(s0, { type: 'NAVIGATE', folderId: 'f-photos' });
    s = demoReducer(s, { type: 'START_UPLOAD', name: 'x.jpg', sizeBytes: 5 });
    expect(s.uploads).toHaveLength(1);
    s = demoReducer(s, { type: 'TICK_UPLOADS', step: 60 });
    expect(s.uploads[0].progress).toBe(60);
    s = demoReducer(s, { type: 'TICK_UPLOADS', step: 60 });
    expect(s.uploads).toHaveLength(0);
    const added = s.files.find((f) => f.name === 'x.jpg');
    expect(added?.folderId).toBe('f-photos');
    expect(added?.kind).toBe('image');
    expect(s.activity[0].text).toContain('x.jpg');
    expect(s.toast?.cta).toBe(true);
  });
  it('uploads without a name draw from the canned set', () => {
    let s = demoReducer(s0, { type: 'START_UPLOAD' });
    expect(s.uploads[0].name).toBe('quarterly-report.pdf');
    s = demoReducer(s, { type: 'START_UPLOAD' });
    expect(s.uploads[1].name).toBe('holiday-photos.zip');
  });
});

describe('share', () => {
  it('creates a dosya.dev/s/ link, marks file shared, logs activity', () => {
    let s = demoReducer(s0, { type: 'OPEN_SHARE', fileId: 'p1' });
    s = demoReducer(s, { type: 'CREATE_LINK' });
    expect(s.shareLink).toMatch(/^https:\/\/dosya\.dev\/s\/[a-z2-9]{5}$/);
    expect(s.files.find((f) => f.id === 'p1')?.shared).toBe(true);
    expect(s.activity[0].text).toContain('sunset-beach.jpg');
  });
});
