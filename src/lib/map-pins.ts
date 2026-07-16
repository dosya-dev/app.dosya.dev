import { api } from '@/api/client';

// File pins are a superset of FileItem (see file-viewer.tsx) so one can be passed
// straight to <FileViewer>, plus the map-specific fields the API adds.
export interface FilePin {
  kind: 'file';
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
  source: 'exif' | 'ip' | null;
}

// Folders have no EXIF, so their location (when present) is always IP-derived.
export interface FolderPin {
  kind: 'folder';
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  source: 'exif' | 'ip' | null;
}

export type MapPin = FilePin | FolderPin;

export interface MapPinsResponse {
  ok: boolean;
  pins: MapPin[];
  counts: { gps: number; approximate: number; pending: number };
}

export function fetchMapPins(workspaceId: string): Promise<MapPinsResponse> {
  return api<MapPinsResponse>(`/api/map/pins?workspace_id=${encodeURIComponent(workspaceId)}`);
}
