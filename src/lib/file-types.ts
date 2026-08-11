/**
 * Shapes returned by GET /api/files, shared by every surface that renders a
 * listing row.
 *
 * These were declared separately in the files page and the file viewer with
 * different field sets (the viewer's omitted `origin`), so the same API row was
 * described two incompatible ways and a field added to one never reached the
 * other. One declaration, one place to update.
 */

export interface FileItem {
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
  /**
   * Who `is_hidden` hides this from - "none" | "everyone" | "users" | "roles".
   * Optional for the same reason `origin` is: surfaces that build their own
   * FileItem-shaped rows (map pins, file-request uploads) don't select it.
   */
  hidden_mode?: string;
  uploaded_by: string;
  uploader_name: string;
  share_count: number;
  comment_count: number;
  is_synced: number;
  /**
   * Which client uploaded the file. Optional because the surfaces that feed
   * the viewer their own rows (the map's geotagged pins, a file request's
   * uploads) genuinely don't select it - `OriginBadge` and `originLabel` both
   * take undefined and render nothing.
   */
  origin?: string | null;
  /** Only populated by the deleted=1 listing. */
  deleted_at?: number | null;
}

export interface FolderItem {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  file_count: number;
  lock_mode: string;
  is_hidden: number;
  /** Who `is_hidden` hides this from - "none" | "everyone" | "users" | "roles". */
  hidden_mode?: string;
  is_synced: number;
  total_size_bytes: number;
  content_updated_at: number;
  region: string | null;
  uploader_name: string | null;
  share_count: number;
  comment_count: number;
  origin: string | null;
  /** Only populated by the deleted=1 listing. */
  deleted_at?: number | null;
  /**
   * True only for rows in the top-level trash listing (the folder the user
   * actually deleted) - false for descendants surfaced while browsing into
   * one. Only a trash root can be restored or purged.
   */
  is_trash_root?: boolean;
}

export interface Breadcrumb {
  id: string;
  name: string;
}

export interface Pagination {
  page: number;
  per_page: number;
  total_files: number;
  total_pages: number;
}
