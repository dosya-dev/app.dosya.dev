export interface CommentMention { id: string; name: string }
export interface Comment {
  id: string; file_id: string | null; folder_id: string | null; workspace_id: string; user_id: string;
  parent_id: string | null; body: string; is_edited: number; created_at: number; updated_at: number;
  user_name: string; user_email: string; user_avatar: string | null;
  anchor_ms: number | null; anchor_page: number | null; anchor_version: number | null;
  mention_user_ids: string | null; mentions: CommentMention[];
}
// `email` is null when the caller's role lacks view_team_members (the roster
// stays behind that key; the picker then matches and shows names only).
export interface MentionCandidate { id: string; name: string; email: string | null; avatar_url: string | null }
export type DraftAnchor = { kind: 'time'; ms: number } | { kind: 'page'; page: number } | null;
