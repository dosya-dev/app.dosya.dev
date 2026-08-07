import { describe, expect, test } from 'vitest';
import { filesRequestPath, filesQueryKey, FILES_QUERY_ROOT, type FilesView } from './files-request';

const base: FilesView = {
  workspaceId: 'w1', folderId: null, filter: '', group: '', sort: 'newest', search: '', page: 1,
};

const paramsOf = (view: FilesView) => new URLSearchParams(filesRequestPath(view).split('?')[1]);

describe('filesRequestPath', () => {
  test('root view sends workspace, sort and pagination only', () => {
    const p = paramsOf(base);
    expect(p.get('workspace_id')).toBe('w1');
    expect(p.get('sort')).toBe('newest');
    expect(p.get('page')).toBe('1');
    expect(p.get('per_page')).toBe('100');
    expect(p.get('folder_id')).toBeNull();
  });

  test('a live folder is addressed with folder_id', () => {
    expect(paramsOf({ ...base, folderId: 'f1' }).get('folder_id')).toBe('f1');
  });

  test('inside the trash a folder is addressed with `folder`, not folder_id', () => {
    // The API keeps these separate: `folder` addresses a TRASHED folder and must
    // not feed the live folder filter. See GET /api/files in apps/api.
    const p = paramsOf({ ...base, filter: 'deleted', folderId: 'f1' });
    expect(p.get('deleted')).toBe('1');
    expect(p.get('folder')).toBe('f1');
    expect(p.get('folder_id')).toBeNull();
  });

  test('the trash root sets deleted without any folder param', () => {
    const p = paramsOf({ ...base, filter: 'deleted' });
    expect(p.get('deleted')).toBe('1');
    expect(p.get('folder')).toBeNull();
  });

  test('the hidden view sets hidden=1 rather than filter=hidden', () => {
    const p = paramsOf({ ...base, filter: 'hidden' });
    expect(p.get('hidden')).toBe('1');
    expect(p.get('filter')).toBeNull();
  });

  test('a type filter is passed through as filter', () => {
    expect(paramsOf({ ...base, filter: 'images' }).get('filter')).toBe('images');
  });

  test('deleted is never also sent as a type filter', () => {
    expect(paramsOf({ ...base, filter: 'deleted' }).get('filter')).toBeNull();
  });

  test('search is sent as q, and omitted when empty', () => {
    expect(paramsOf({ ...base, search: 'report' }).get('q')).toBe('report');
    expect(paramsOf(base).get('q')).toBeNull();
  });

  test('a group view sends group_id', () => {
    expect(paramsOf({ ...base, group: 'g1' }).get('group_id')).toBe('g1');
  });

  test('page is carried through', () => {
    expect(paramsOf({ ...base, page: 3 }).get('page')).toBe('3');
  });

  test('an unlock token rides along with folder_id as ut', () => {
    const p = paramsOf({ ...base, folderId: 'f1', unlockToken: 'ut_abc' });
    expect(p.get('folder_id')).toBe('f1');
    expect(p.get('ut')).toBe('ut_abc');
  });

  test('no ut param when there is no token', () => {
    expect(paramsOf({ ...base, folderId: 'f1' }).get('ut')).toBeNull();
  });

  test('a token without a folder is never sent - the API only checks locks when entering one', () => {
    expect(paramsOf({ ...base, unlockToken: 'ut_abc' }).get('ut')).toBeNull();
  });

  test('the trash ignores unlock tokens', () => {
    // `deleted=1` takes the other branch entirely; sending ut there would imply
    // a lock check the API does not perform on trashed folders.
    const p = paramsOf({ ...base, filter: 'deleted', folderId: 'f1', unlockToken: 'ut_abc' });
    expect(p.get('ut')).toBeNull();
  });
});

describe('filesQueryKey', () => {
  test('is rooted at FILES_QUERY_ROOT and scoped by workspace, so one workspace can be invalidated wholesale', () => {
    const key = filesQueryKey(base);
    expect(key[0]).toBe(FILES_QUERY_ROOT);
    expect(key[1]).toBe('w1');
  });

  test('two views that produce the same request share a key', () => {
    expect(filesQueryKey(base)).toEqual(filesQueryKey({ ...base }));
  });

  test('any param that changes the request also changes the key', () => {
    const variants: Partial<FilesView>[] = [
      { folderId: 'f1' }, { filter: 'images' }, { filter: 'deleted' }, { filter: 'hidden' },
      { group: 'g1' }, { sort: 'oldest' }, { search: 'x' }, { page: 2 },
      // The token belongs in the key: a locked and an unlocked listing of the
      // same folder are different responses, and an expired token must not keep
      // serving the unlocked one from cache.
      { folderId: 'f1', unlockToken: 'ut_abc' },
    ];
    const baseKey = JSON.stringify(filesQueryKey(base));
    for (const v of variants) {
      expect(JSON.stringify(filesQueryKey({ ...base, ...v }))).not.toBe(baseKey);
    }
  });

  test('a different workspace never collides', () => {
    expect(filesQueryKey({ ...base, workspaceId: 'w2' })).not.toEqual(filesQueryKey(base));
  });
});
