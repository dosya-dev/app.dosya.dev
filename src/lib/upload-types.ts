export type UploadStatus =
  | 'queued'
  | 'uploading'
  | 'complete'
  | 'error'
  | 'interrupted'
  | 'canceled';

export interface UploadItem {
  id: string;
  session_id: string | null;
  fileName: string;
  fileSize: number;
  mimeType: string;
  workspace_id: string;
  folder_id: string | null;
  region: string;
  /** Set when this upload replaces an existing file's contents (new version). */
  file_id?: string | null;
  status: UploadStatus;
  progress: number;        // 0..100
  bytesUploaded: number;
  part_size: number | null;
  total_parts: number | null;
  uploaded_parts: number[];
  speedBps?: number;       // current upload speed, bytes/sec (smoothed); transient
  fileId?: string;         // id of the created file, set once the upload completes
  error?: string;
}

export interface UploadInput {
  workspace_id: string;
  folder_id: string | null;
  /** Omit to let the server apply the workspace's default region. */
  region?: string;
  /** Set to upload a new version of an existing file instead of creating one. */
  file_id?: string | null;
}
