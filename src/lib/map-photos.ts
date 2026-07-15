import { api } from '@/api/client';

// Superset of FileItem (see file-viewer.tsx) so a MapPhoto can be passed straight to <FileViewer>.
export interface MapPhoto {
  id: string;
  name: string;
  size_bytes: number;
  mime_type: string;
  extension: string;
  region: string;
  created_at: number;
  updated_at: number;
  current_version: number;
  lock_mode: string;
  is_hidden: number;
  uploaded_by: string;
  uploader_name: string;
  share_count: number;
  comment_count: number;
  is_synced: number;
  latitude: number;
  longitude: number;
  captured_at: string | null;
}

export interface MapPhotosResponse {
  ok: boolean;
  photos: MapPhoto[];
  counts: { geotagged: number; pending: number };
}

export function fetchMapPhotos(workspaceId: string): Promise<MapPhotosResponse> {
  return api<MapPhotosResponse>(`/api/map/photos?workspace_id=${encodeURIComponent(workspaceId)}`);
}
