import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, RotateCcw, RotateCw, Shuffle, Repeat,
  Music, Volume2, VolumeX, Gauge, Timer, MicVocal, ListMusic,
} from 'lucide-react';
import { mmss, stripExt } from '@dosya-dev/audio-player';
import { humanSize, extOf, isAudio } from '@/lib/helpers';
import type { FileItem } from '@/lib/file-types';
import { useAudioTags } from './use-audio-tags';
import { usePeaks } from './use-peaks';
import { useAudioKeys } from './use-audio-keys';
import { useLyrics } from './use-lyrics';
import { Waveform } from './waveform';
import { QueuePanel } from './queue-panel';
import { LyricsPanel } from './lyrics-panel';
import { LOOP_OFF, nextLoopState, nextSpeed, SLEEP_OPTIONS, type LoopState } from './audio-modes';

interface Props {
  file: FileItem;
  files: FileItem[];
  rawUrl: string;
  downloadUrl: string;
  version: number | undefined;
  onNavigate: (f: FileItem) => void;
}

export function AudioPlayer({ file, files, rawUrl, version, onNavigate }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.72);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loopState, setLoopState] = useState<LoopState>(LOOP_OFF);
  const [sleepAt, setSleepAt] = useState<number | null>(null);
  const [sleepLabel, setSleepLabel] = useState<string | null>(null);
  const [sleepOpen, setSleepOpen] = useState(false);
  const [tab, setTab] = useState<'queue' | 'lyrics'>('queue');

  const { tags, artworkUrl } = useAudioTags(rawUrl, file.name);
  const cacheKey = useMemo(() => `${file.id}:${version ?? 'current'}`, [file.id, version]);
  const { peaks, state: waveState } = usePeaks(rawUrl, cacheKey, file.size_bytes);

  const title = tags.title || stripExt(file.name);
  const lyrics = useLyrics(tags);

  // The queue is the audio siblings the viewer already holds - no extra fetch.
  const queue = useMemo(() => files.filter((f) => isAudio(f.name)), [files]);
  const activeIndex = useMemo(() => queue.findIndex((f) => f.id === file.id), [queue, file.id]);

  const goTrack = (dir: number) => {
    if (activeIndex < 0) return;
    const next = activeIndex + dir;
    if (next < 0 || next >= queue.length) return;
    onNavigate(queue[next]);
  };
  // The ended handler is registered once per source but must always call the
  // current goTrack, which closes over activeIndex.
  const goTrackRef = useRef(goTrack);
  goTrackRef.current = goTrack;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      setPosition(el.currentTime);
      // The loop and the sleep countdown both ride the element's own clock
      // rather than a second timer that could drift away from playback.
      const lp = loopState.loop;
      if (lp && el.currentTime >= lp.b) el.currentTime = lp.a;
      if (sleepAt !== null) {
        const left = Math.max(0, Math.round((sleepAt - Date.now()) / 1000));
        setSleepLabel(mmss(left));
        if (left <= 0) {
          el.pause();
          setPlaying(false);
          setSleepAt(null);
          setSleepLabel(null);
        }
      }
    };
    const onMeta = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onEnd = () => { setPlaying(false); goTrackRef.current(1); };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnd);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('ended', onEnd);
    };
  }, [rawUrl, loopState.loop, sleepAt]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) { el.volume = volume; el.muted = muted; }
  }, [volume, muted]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = speed;
  }, [speed]);

  // A new track starts clean: an A-B region from the last song means nothing
  // here, and a sleep timer is about the session, so it survives.
  useEffect(() => { setLoopState(LOOP_OFF); }, [file.id]);
  useEffect(() => { if (!lyrics && tab === 'lyrics') setTab('queue'); }, [lyrics, tab]);

  const seek = (to: number) => {
    const next = Math.min(duration || 0, Math.max(0, to));
    const el = audioRef.current;
    if (el) el.currentTime = next;
    setPosition(next);
  };

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) { void el.play(); setPlaying(true); } else { el.pause(); setPlaying(false); }
  };

  useAudioKeys({
    toggle,
    seekBy: (d) => seek(position + d),
    nextTrack: goTrack,
    toggleMute: () => setMuted((m) => !m),
  });

  // Only facts the file actually reported. A chip reading "0 kbps" would be
  // worse than no chip at all.
  const chips = [
    (extOf(file.name) || 'file').toUpperCase(),
    tags.bitrateKbps ? `${tags.bitrateKbps} kbps` : null,
    tags.sampleRateHz ? `${(tags.sampleRateHz / 1000).toFixed(1)} kHz` : null,
    humanSize(file.size_bytes),
  ].filter(Boolean) as string[];

  // Every armed mode writes a chip here, so nothing is ever running invisibly.
  const armChips = [
    loopState.loop ? `A-B ${mmss(loopState.loop.a)}-${mmss(loopState.loop.b)}` : null,
    loopState.stage === 1 ? `A ${mmss(loopState.a ?? 0)} - set B` : null,
    sleepLabel ? `Sleep ${sleepLabel}` : null,
    speed !== 1 ? `${speed}x` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="flex w-full flex-1 flex-col self-stretch min-h-0">
      <audio ref={audioRef} src={rawUrl} preload="metadata" />

      <div className="flex flex-col px-8 pt-7 pb-6">
        <div className="flex items-start gap-[26px]">
          <div className="relative isolate size-[168px] shrink-0 rounded-[calc(var(--radius)+2px)]">
            {artworkUrl ? (
              <>
                <img
                  src={artworkUrl}
                  alt={`Cover art for ${title}`}
                  className="relative z-10 size-full rounded-[inherit] object-cover shadow-[0_16px_34px_-14px_rgb(0_0_0/0.55)]"
                />
                {/* The only art-derived colour on the surface: light spilling
                    out from under the sleeve. Every control stays on theme
                    tokens so contrast holds across all eight themes. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-0 translate-y-5 scale-[1.04] rounded-[inherit] bg-cover opacity-50 blur-[26px] saturate-150"
                  style={{ backgroundImage: `url(${artworkUrl})` }}
                />
              </>
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-2.5 rounded-[inherit] border bg-muted text-muted-foreground">
                <Music className="size-[34px] opacity-75" />
                <span className="font-mono text-[11px] font-bold tracking-wider">
                  {(extOf(file.name) || '').toUpperCase()}
                </span>
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 pt-1">
            <h2 className="mb-[7px] break-words text-2xl font-bold leading-[1.18] tracking-[-0.025em]">
              {title}
            </h2>
            {tags.artist && <p className="m-0 text-base font-medium">{tags.artist}</p>}
            {tags.album && <p className="mt-[3px] text-sm text-muted-foreground">{tags.album}</p>}

            <div className="mt-4 flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <span
                  key={c}
                  className="whitespace-nowrap rounded-[calc(var(--radius)*0.42)] border bg-background px-2 py-[5px] font-mono text-[10px] leading-none text-muted-foreground"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>

        {waveState === 'ready' && peaks ? (
          <Waveform peaks={peaks} position={position} duration={duration} loop={loopState.loop} onSeek={seek} />
        ) : (
          <div className="mt-[22px] flex h-[78px] items-center">
            {waveState === 'decoding' ? (
              // Flat bars that the waveform rises out of once the peaks land.
              <div className="flex h-full w-full items-center gap-[2px]" aria-hidden>
                {Array.from({ length: 60 }, (_, i) => (
                  <i
                    key={i}
                    className="block flex-1 animate-pulse rounded-sm bg-foreground/15"
                    style={{ height: `${4 + Math.round(7 * (0.5 + 0.5 * Math.sin(i * 0.55)))}px` }}
                  />
                ))}
              </div>
            ) : (
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.round(duration))}
                value={Math.round(position)}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label="Seek"
                className="w-full accent-primary"
              />
            )}
          </div>
        )}

        <div className="mt-[9px] flex items-center justify-between gap-3 font-mono text-xs tabular-nums text-muted-foreground">
          <span className="font-bold text-foreground">{mmss(position)}</span>
          <span className="flex items-center gap-2.5">
            {armChips.map((c) => (
              <span
                key={c}
                className="whitespace-nowrap rounded-[calc(var(--radius)*0.42)] border border-primary/55 bg-primary/10 px-2 py-[3px] text-[10px] leading-none text-primary"
              >
                {c}
              </span>
            ))}
          </span>
          <span>{mmss(duration)}</span>
        </div>

        <div className="mt-5 flex items-center justify-center gap-2">
          <button className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10" title="Shuffle queue" aria-label="Shuffle queue">
            <Shuffle className="size-[17px]" />
          </button>
          <button
            onClick={() => (position > 3 ? seek(0) : goTrack(-1))}
            disabled={activeIndex <= 0 && position <= 3}
            className="inline-flex size-10 items-center justify-center rounded-full hover:bg-foreground/10 disabled:pointer-events-none disabled:opacity-35"
            title="Previous track (Shift + Left)"
            aria-label="Previous track"
          >
            <SkipBack className="size-5" />
          </button>
          <button onClick={() => seek(position - 15)} className="relative inline-flex size-10 items-center justify-center rounded-full hover:bg-foreground/10" title="Back 15 seconds (J)" aria-label="Back 15 seconds">
            <RotateCcw className="size-[21px]" />
            <span aria-hidden className="absolute inset-0 flex items-center justify-center pt-px font-mono text-[8px] font-bold">15</span>
          </button>
          <button
            onClick={toggle}
            className="mx-1.5 inline-flex size-[58px] items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_6px_16px_-8px_rgb(0_0_0/0.5)] transition-transform hover:brightness-95 active:scale-95"
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
          >
            {playing ? <Pause className="size-5 fill-current" /> : <Play className="size-[23px] fill-current" />}
          </button>
          <button onClick={() => seek(position + 15)} className="relative inline-flex size-10 items-center justify-center rounded-full hover:bg-foreground/10" title="Forward 15 seconds (L)" aria-label="Forward 15 seconds">
            <RotateCw className="size-[21px]" />
            <span aria-hidden className="absolute inset-0 flex items-center justify-center pt-px font-mono text-[8px] font-bold">15</span>
          </button>
          <button
            onClick={() => goTrack(1)}
            disabled={activeIndex < 0 || activeIndex >= queue.length - 1}
            className="inline-flex size-10 items-center justify-center rounded-full hover:bg-foreground/10 disabled:pointer-events-none disabled:opacity-35"
            title="Next track (Shift + Right)"
            aria-label="Next track"
          >
            <SkipForward className="size-5" />
          </button>
          <button className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10" title="Repeat queue" aria-label="Repeat queue">
            <Repeat className="size-[17px]" />
          </button>
        </div>

        <div className="mt-[18px] flex flex-wrap items-center gap-1.5 border-t pt-4">
          <button
            onClick={() => setSpeed((s) => nextSpeed(s, 1) === s ? nextSpeed(s, -6) : nextSpeed(s, 1))}
            className={`inline-flex h-[30px] items-center gap-1.5 rounded-[calc(var(--radius)*0.5)] border px-2.5 text-xs hover:bg-foreground/10 ${
              speed !== 1
                ? 'border-primary/45 bg-primary/10 text-primary'
                : 'border-transparent text-muted-foreground'
            }`}
            title="Playback speed"
            aria-label={`Playback speed, currently ${speed} times`}
          >
            <Gauge className="size-[15px]" />
            <span className="font-mono text-xs tabular-nums">{speed}x</span>
          </button>

          <span className="relative inline-flex">
            <button
              onClick={() => setSleepOpen((o) => !o)}
              aria-haspopup="true"
              aria-expanded={sleepOpen}
              className={`inline-flex h-[30px] items-center gap-1.5 rounded-[calc(var(--radius)*0.5)] border px-2.5 text-xs hover:bg-foreground/10 ${
                sleepLabel
                  ? 'border-primary/45 bg-primary/10 text-primary'
                  : 'border-transparent text-muted-foreground'
              }`}
              title="Stop playing after a while"
            >
              <Timer className="size-[15px]" />
              <span className="font-mono text-xs tabular-nums">{sleepLabel ?? 'Sleep'}</span>
            </button>
            {sleepOpen && (
              <div className="absolute bottom-[calc(100%+8px)] left-0 z-20 min-w-[168px] rounded-[calc(var(--radius)*0.75)] border bg-popover p-1.5 text-popover-foreground shadow-lg">
                <h4 className="m-0 px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Stop playing after
                </h4>
                {SLEEP_OPTIONS.map((o) => (
                  <button
                    key={o.label}
                    onClick={() => {
                      setSleepAt(o.minutes === null ? null : Date.now() + o.minutes * 60_000);
                      setSleepLabel(o.minutes === null ? null : mmss(o.minutes * 60));
                      setSleepOpen(false);
                    }}
                    className="flex w-full items-center rounded-[calc(var(--radius)*0.4)] px-2 py-1.5 text-left text-[13px] hover:bg-foreground/10"
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </span>

          <button
            onClick={() => setLoopState((s) => nextLoopState(s, position))}
            className={`inline-flex h-[30px] items-center gap-1.5 rounded-[calc(var(--radius)*0.5)] border px-2.5 text-xs hover:bg-foreground/10 ${
              loopState.stage > 0
                ? 'border-primary/45 bg-primary/10 text-primary'
                : 'border-transparent text-muted-foreground'
            }`}
            title={
              loopState.stage === 0 ? 'Loop a section - sets point A'
                : loopState.stage === 1 ? 'Set point B to close the loop'
                : 'Clear the loop'
            }
            aria-label="A to B loop"
          >
            <Repeat className="size-[15px]" />
            <span>A-B</span>
          </button>

          <button
            onClick={() => setMuted((m) => !m)}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-[calc(var(--radius)*0.5)] px-2.5 text-xs text-muted-foreground hover:bg-foreground/10"
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX className="size-[15px]" /> : <Volume2 className="size-[15px]" />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v / 100);
              setMuted(v === 0);
            }}
            aria-label="Volume"
            className="w-[78px] accent-primary"
          />
        </div>
      </div>

      {(queue.length > 1 || lyrics) && (
        <div className="flex min-h-0 flex-1 flex-col border-t bg-background">
          <div className="flex shrink-0 items-stretch gap-0.5 border-b pl-5 pr-3">
            {queue.length > 1 && (
              <button
                role="tab"
                aria-selected={tab === 'queue'}
                onClick={() => setTab('queue')}
                className={`-mb-px inline-flex items-center gap-[7px] whitespace-nowrap border-b-2 px-2.5 pb-2.5 pt-[11px] text-[13px] font-semibold transition-colors ${
                  tab === 'queue'
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <ListMusic className="size-[15px]" /> Up next
                <span className="font-mono text-[11px] font-normal text-muted-foreground">{queue.length}</span>
              </button>
            )}
            {/* Present only when this file actually carries lyrics. A disabled
                tab would promise something that will never arrive. */}
            {lyrics && (
              <button
                role="tab"
                aria-selected={tab === 'lyrics'}
                onClick={() => setTab('lyrics')}
                className={`-mb-px inline-flex items-center gap-[7px] whitespace-nowrap border-b-2 px-2.5 pb-2.5 pt-[11px] text-[13px] font-semibold transition-colors ${
                  tab === 'lyrics'
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <MicVocal className="size-[15px]" /> Lyrics
              </button>
            )}
          </div>

          <div className="relative min-h-0 flex-1 overflow-y-auto">
            {tab === 'lyrics' && lyrics ? (
              <LyricsPanel lines={lyrics.lines} synced={lyrics.synced} position={position} />
            ) : (
              <QueuePanel
                queue={queue}
                activeIndex={activeIndex}
                playing={playing}
                folder=""
                onPick={(i) => onNavigate(queue[i])}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
