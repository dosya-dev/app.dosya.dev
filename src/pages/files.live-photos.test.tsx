import { describe, it, expect } from 'vitest';
import { collapseLiveTwins, twinsUnderStills } from '@/lib/live-photos';
import type { FileItem } from '@/lib/file-types';

const row = (o: Partial<FileItem> & { id: string; name: string }): FileItem => ({
  size_bytes: 1, mime_type: 'application/octet-stream', extension: '', region: 'eu', created_at: 0, updated_at: 0,
  current_version: 1, lock_mode: 'none', is_hidden: 0, uploaded_by: 'u', uploader_name: 'U', share_count: 0, comment_count: 0, is_synced: 0,
  ...o,
});

describe('files page Live Photo ordering', () => {
  const still = row({ id: 's', name: 'IMG_1.HEIC', live_video_id: 'v' });
  const twin = row({ id: 'v', name: 'IMG_1.MOV', live_photo_id: 's' });
  const other = row({ id: 'o', name: 'Beach.mp4' });

  it('the grid drops the twin and the list keeps it under the still', () => {
    expect(collapseLiveTwins([twin, still, other]).map((f) => f.id)).toEqual(['s', 'o']);
    expect(twinsUnderStills([twin, other, still]).map((f) => f.id)).toEqual(['o', 's', 'v']);
  });
});
