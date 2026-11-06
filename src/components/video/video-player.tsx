import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DosyaVideo, type DosyaVideoHandle } from '@dosya-dev/video-player/react';
import type { PlayerMarker, ReportConfig } from '@dosya-dev/video-player';
import '@dosya-dev/video-player/skin.css';
import { api, apiErrorMessage } from '@/api/client';
import { useAnchorMarkers, useRegisterAnchorTarget, type AnchorTarget } from '@/components/comments/anchor-context';
import type { FileItem } from '@/lib/file-types';
import { useT } from '@/lib/i18n';
import { reportLabels, videoLabels } from '@/components/video/video-labels';

/**
 * The file viewer's video stage: the shared Video.js player, keyed on file
 * identity. The player reads `src` only when it mounts, so the cache token in
 * stableRawUrl changing (versions arriving, an unrelated re-render) never
 * restarts playback; switching to another version does, through `identity`.
 *
 * A decode failure is the player's own card (the message and Download), and
 * it unregisters the comments anchor target so the panel stops offering to
 * stamp or seek a video that is not playing.
 */
export function VideoPlayer({ file, stableRawUrl, version, downloadUrl }: {
  file: FileItem;
  stableRawUrl: string;
  version?: number;
  downloadUrl: string;
}) {
  const t = useT();
  const identity = `${file.id}:${version ?? 'current'}`;
  const handle = useRef<DosyaVideoHandle>(null);
  const { markers, selectComment } = useAnchorMarkers();

  const playerMarkers = useMemo<PlayerMarker[]>(
    () => markers.filter((m) => m.ms != null).map((m) => ({ id: m.id, ms: m.ms!, label: m.excerpt, dim: m.dim })),
    [markers],
  );

  // Registered once the duration is known and dropped on failure. The
  // functions go through the handle, never state, so they stay valid across
  // re-renders without re-registering.
  const [anchorTarget, setAnchorTarget] = useState<AnchorTarget | null>(null);
  useRegisterAnchorTarget(anchorTarget);
  const onDuration = useCallback((seconds: number) => {
    if (!(seconds > 0)) return;
    setAnchorTarget((prev) => prev ?? {
      kind: 'time',
      now: () => handle.current?.currentTimeMs() ?? 0,
      seek: (ms) => handle.current?.seekMs(ms),
      pause: () => handle.current?.pause(),
    });
  }, []);
  const onFailed = useCallback(() => setAnchorTarget(null), []);
  // A version switch remounts the player; until the new one reports a duration
  // the old target would read now() === 0 from a player that is still loading.
  useEffect(() => { setAnchorTarget(null); }, [identity]);

  const fileId = file.id;
  const labels = useMemo(() => videoLabels(t), [t]);
  const report = useMemo<ReportConfig>(() => ({
    reasons: ['playback'],
    labels: reportLabels(t),
    submit: async (payload) => {
      try {
        await api<{ ok: true; reference: string }>(`/api/files/${fileId}/report`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'playback', details: payload.details || undefined, diagnostics: payload.diagnostics }),
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: apiErrorMessage(err, t('common.error.couldnTSendTheReport')) };
      }
    },
  }), [fileId, t]);

  // The player is a media surface: its timeline and controls read left to right
  // in every language. `contents` keeps the wrapper out of the layout; the
  // prose panels it renders take the page direction back (index.css).
  return (
    <div dir="ltr" className="contents">
    <DosyaVideo
      ref={handle}
      identity={identity}
      src={stableRawUrl}
      className="flex h-full w-full items-center justify-center"
      title={file.name}
      autoplay
      downloadUrl={downloadUrl}
      failureText={t('common.error.thisBrowserCanTDecodeThisVideoDownloadItAndOpenIt')}
      markers={playerMarkers}
      onMarkerSelect={selectComment}
      onDuration={onDuration}
      onFailed={onFailed}
      report={report}
      labels={labels}
    />
    </div>
  );
}
