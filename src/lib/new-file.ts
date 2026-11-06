/**
 * Creates a blank file from the files page's "New" menu.
 *
 * A direct init + PUT, the same two calls the text editor's save makes, but
 * WITHOUT `file_id`: this is a new file, and the PUT's 201 body carries its id
 * so the caller can open it straight away. The shared upload runner is not
 * used because it never hands the id back.
 *
 * The upload API quietly turns a same-name upload into a new version of the
 * existing file. A "new" file must never do that, so the folder is asked for
 * the name first (`q` narrows to this folder only, as a substring match, so
 * the answer is filtered to exact, case-insensitive hits on files AND
 * folders).
 */
import { api, API_BASE, responseErrorMessage } from '@/api/client';
import { blankFileBlob, nameTaken, NEW_FILE_SPECS, type NewFileKind } from '@/lib/blank-files';
import { t } from '@/lib/i18n';

export interface CreateBlankFileInput {
  workspaceId: string;
  /** null = workspace root. */
  folderId: string | null;
  /** Already normalised (extension right) and validated. */
  name: string;
  kind: NewFileKind;
  /** Unlock token of a full_lock folder being browsed, as the listing sends it. */
  unlockToken?: string | null;
}

export type CreateBlankFileResult =
  | { ok: true; fileId: string; name: string }
  | { ok: false; conflict: true }
  | { ok: false; conflict?: false; error: string };

/** Whether the folder already holds a file or folder called `name`, per the API. */
export async function folderHasName(input: Pick<CreateBlankFileInput, 'workspaceId' | 'folderId' | 'name' | 'unlockToken'>): Promise<boolean> {
  const params = new URLSearchParams({ workspace_id: input.workspaceId, q: input.name, per_page: '500' });
  if (input.folderId) {
    params.set('folder_id', input.folderId);
    if (input.unlockToken) params.set('ut', input.unlockToken);
  }
  const res = await api<{ ok: boolean; files?: { name: string }[]; folders?: { name: string }[] }>(`/api/files?${params}`);
  return nameTaken(input.name, [...(res.files ?? []), ...(res.folders ?? [])]);
}

export async function createBlankFile(input: CreateBlankFileInput): Promise<CreateBlankFileResult> {
  if (await folderHasName(input)) return { ok: false, conflict: true };

  const spec = NEW_FILE_SPECS[input.kind];
  const blob = blankFileBlob(input.kind);
  const init = await api<{ ok: boolean; session_id?: string; error?: string }>('/api/upload/init', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      folder_id: input.folderId,
      file_name: input.name,
      file_size: blob.size,
      mime_type: spec.mimeType,
    }),
  });
  if (!init.ok || !init.session_id) return { ok: false, error: init.error ?? t('common.error.couldNotStartUpload') };

  const put = await fetch(`${API_BASE}/api/upload/${init.session_id}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': spec.mimeType },
    body: blob,
  });
  if (!put.ok) return { ok: false, error: await responseErrorMessage(put, t('files.error.couldNotCreateTheFile')) };
  const data = await put.json() as { ok: boolean; error?: string; file?: { id: string; name?: string } };
  if (!data.ok || !data.file?.id) return { ok: false, error: data.error ?? t('files.error.couldNotCreateTheFile') };
  return { ok: true, fileId: data.file.id, name: data.file.name ?? input.name };
}
