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
  status: UploadStatus;
  progress: number;        // 0..100
  bytesUploaded: number;
  part_size: number | null;
  total_parts: number | null;
  uploaded_parts: number[];
  error?: string;
}

export interface UploadInput {
  workspace_id: string;
  folder_id: string | null;
  region: string;
}
