import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, API_BASE } from '@/api/client';
import { useDocumentTitle } from '@/lib/page-title';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChevronLeft, Download, Copy, Check, Mail, Clock, Lock,
  FileText, Users, Loader2,
} from 'lucide-react';
import { humanSize, timeAgo, fileIconSrc } from '@/lib/helpers';
import { toast } from '@/lib/toast';

interface RequestDetail {
  id: string;
  token: string;
  title: string | null;
  message: string | null;
  url: string;
  is_revoked: number;
  is_password_protected: number;
  expires_at: number | null;
  allowed_extensions: string | null;
  max_file_size_bytes: number | null;
  max_files: number | null;
  upload_count: number;
  created_at: number;
  created_by_name: string | null;
}

interface Upload {
  id: string;
  file_id: string;
  uploader_email: string | null;
  uploader_name: string | null;
  created_at: number;
  file_name: string;
  size_bytes: number;
  mime_type: string;
  extension: string | null;
}

interface Recipient {
  id: string;
  email: string;
  sent_at: number | null;
  uploaded_at: number | null;
}

export default function FileRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useDocumentTitle(request?.title ? `${request.title} · File request` : 'File request');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [uploadsRes, recipientsRes] = await Promise.all([
        api<{ ok: boolean; uploads: Upload[]; title: string | null }>(`/api/file-requests/${id}/uploads`),
        api<{ ok: boolean; recipients: Recipient[]; title: string | null; request_token: string }>(`/api/file-requests/${id}/recipients`),
      ]);
      if (uploadsRes.ok) setUploads(uploadsRes.uploads);
      if (recipientsRes.ok) setRecipients(recipientsRes.recipients);
    } catch {}
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleCopy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success('Link copied', 'The request link is on your clipboard.');
    setTimeout(() => setCopied(false), 2000);
  };

  const now = Math.floor(Date.now() / 1000);
  const uploadedCount = recipients.filter((r) => r.uploaded_at).length;
  const pendingCount = recipients.filter((r) => !r.uploaded_at).length;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <Link to="/file-requests" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ChevronLeft className="size-3.5" /> Back to file requests
      </Link>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : (
        <>
          <h1 className="text-xl font-bold mb-5">File Request Uploads</h1>

          {/* Recipients summary */}
          <Card className="gap-0 py-0 p-4 mb-5">
            <div className="flex items-center gap-2 mb-3">
              <Users className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Recipients ({recipients.length})</span>
            </div>
            {recipients.length === 0 ? (
              <p className="text-xs text-muted-foreground">No recipients</p>
            ) : (
              <div className="space-y-1.5">
                {recipients.map((r) => (
                  <div key={r.id} className="flex items-center gap-2.5 text-xs">
                    <div className={`size-2 rounded-full shrink-0 ${r.uploaded_at ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                    <span className="flex-1 truncate">{r.email}</span>
                    <span className="text-muted-foreground">{r.uploaded_at ? `Uploaded ${timeAgo(r.uploaded_at)}` : 'Pending'}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-3 mt-3 pt-3 border-t text-xs text-muted-foreground">
              <span className="text-green-600 font-medium">{uploadedCount} uploaded</span>
              <span>{pendingCount} pending</span>
            </div>
          </Card>

          {/* Uploads */}
          <Card className="gap-0 py-0 overflow-hidden">
            <div className="px-4 py-3 border-b">
              <span className="text-sm font-semibold">Uploads ({uploads.length})</span>
            </div>
            {uploads.length === 0 ? (
              <div className="py-10 text-center">
                <FileText className="size-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No files uploaded yet</p>
              </div>
            ) : (
              uploads.map((u) => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 hover:bg-muted/50">
                  <div className="size-9 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
                    <img src={fileIconSrc(u.file_name)} alt="" className="size-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{u.file_name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {humanSize(u.size_bytes)} &middot; {u.uploader_name || u.uploader_email || 'Anonymous'} &middot; {timeAgo(u.created_at)}
                    </p>
                  </div>
                  <a href={`${API_BASE}/api/files/${u.file_id}/download`} download className="size-8 rounded-md flex items-center justify-center hover:bg-muted shrink-0" title="Download">
                    <Download className="size-4 text-muted-foreground" />
                  </a>
                </div>
              ))
            )}
          </Card>
        </>
      )}
    </div>
  );
}
