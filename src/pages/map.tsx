import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { MapPin as MapPinIcon, Loader2 } from 'lucide-react';
import { useWorkspace } from '@/stores/workspace';
import { subscribeThemeChange } from '@/lib/theme';
import { fetchMapPins, type MapPin, type FilePin, type MapFilters } from '@/lib/map-pins';
import { MapFilterPanel } from '@/components/map-filter-panel';
import { markerFor } from '@/lib/map-marker';
import { pinsToFeatures, buildClusterIndex, clustersInView } from '@/lib/map-cluster';
import { buildMapStyle, checkBasemapAvailable } from '@/lib/map-style';
import { fileThumbUrl, fileRawUrl } from '@/lib/file-url';
import { FileViewer } from '@/components/file-viewer';
import { FilesSidebar } from '@/components/files-sidebar';
import { filterNavParams, groupNavParams } from '@/lib/files-params';

let pmtilesRegistered = false;
function ensurePmtiles() {
  if (pmtilesRegistered) return;
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  pmtilesRegistered = true;
}

// Lucide's default SVG frame (see lucide-react's defaultAttributes) — matched by
// hand so the marker icons render without mounting a React tree into imperative
// maplibre marker elements (which are built with document.createElement, same as
// the cluster-count bubble below).
function iconSvg(paths: string[]): string {
  const body = paths.map((d) => `<path d="${d}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
// lucide-react's FileText icon path data.
const FILE_ICON_SVG = iconSvg([
  'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z',
  'M14 2v5a1 1 0 0 0 1 1h5',
  'M10 9H8',
  'M16 13H8',
  'M16 17H8',
]);
// lucide-react's FolderOpen icon path data.
const FOLDER_ICON_SVG = iconSvg([
  'm6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2',
]);

// Raster types the thumbnail pipeline can rasterize; other image-ish types
// (svg/gif/ico) render directly from their raw URL in the browser instead.
const RASTER_THUMB = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tiff', '.tif', '.bmp']);
function pinImageUrl(p: FilePin): string {
  const ext = (p.extension || '').toLowerCase();
  return RASTER_THUMB.has(ext) ? fileThumbUrl({ fileId: p.id, size: 128 }) : fileRawUrl({ fileId: p.id });
}
const isRasterFile = (p: MapPin): p is FilePin =>
  p.kind === 'file' && RASTER_THUMB.has((p.extension || '').toLowerCase());

export default function MapPage() {
  const navigate = useNavigate();
  const wsId = useWorkspace((s) => s.activeId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  const [pins, setPins] = useState<MapPin[]>([]);
  const [counts, setCounts] = useState({ gps: 0, approximate: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [viewerFile, setViewerFile] = useState<FilePin | null>(null);
  const [showApprox, setShowApprox] = useState(true);
  const [filters, setFilters] = useState<MapFilters>({});
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  // Whether the basemap .pmtiles is provisioned. Until it is (or if the probe
  // fails), the map renders a clean empty background rather than 404-ing on a
  // missing sprite/tiles. Auto-upgrades to the real basemap once available.
  const [hasBasemap, setHasBasemap] = useState(false);

  // All file pins (for the viewer's prev/next + thumbnail strip) — folders never
  // open the viewer, so they're excluded regardless of the approximate filter.
  const filePins = useMemo(() => pins.filter((p): p is FilePin => p.kind === 'file'), [pins]);

  // Pins actually shown on the map: hide IP-derived (approximate) pins when the
  // toggle is off. Clustering runs over exactly this set.
  const visiblePins = useMemo(
    () => (showApprox ? pins : pins.filter((p) => p.source !== 'ip')),
    [pins, showApprox],
  );
  const byId = useMemo(() => new Map(visiblePins.map((p) => [p.id, p] as const)), [visiblePins]);
  const index = useMemo(() => buildClusterIndex(pinsToFeatures(visiblePins)), [visiblePins]);

  const loadPins = useCallback(async () => {
    if (!wsId) return;
    setLoading(true);
    try {
      const data = await fetchMapPins(wsId, filters);
      if (data.ok) { setPins(data.pins); setCounts(data.counts); }
    } catch { /* leave empty state */ }
    setLoading(false);
  }, [wsId, filters]);

  useEffect(() => { loadPins(); }, [loadPins]);
  useEffect(() => subscribeThemeChange(() => setDark(document.documentElement.classList.contains('dark'))), []);
  useEffect(() => { checkBasemapAvailable().then(setHasBasemap); }, []);

  // Auto-fit the view to the pins once (like Apple Photos). Without this, pins
  // that all sit in one far-off place (e.g. every upload's IP city) fall outside
  // the default world view and never appear on screen.
  const didFitRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || didFitRef.current || pins.length === 0) return;
    didFitRef.current = true;
    let west = 180, south = 90, east = -180, north = -90;
    for (const p of pins) {
      west = Math.min(west, p.longitude); east = Math.max(east, p.longitude);
      south = Math.min(south, p.latitude); north = Math.max(north, p.latitude);
    }
    const fit = () => map.fitBounds([[west, south], [east, north]], { padding: 90, maxZoom: 12, duration: 0 });
    if (map.loaded()) fit(); else map.once('load', fit);
  }, [pins]);

  // Render cluster/pin markers for the current viewport.
  const renderMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    // Whole world, NOT map.getBounds(): once you pan horizontally the bounds run
    // outside ±180° (world copies) and supercluster returns nothing, wiping every
    // pin. Pin counts are small and MapLibre culls off-screen markers + wraps them
    // to the visible world copy, so it's safe (and correct) to render them all.
    const bbox: [number, number, number, number] = [-180, -85, 180, 85];
    // Build one Apple-style teardrop: rounded photo frame (or file/folder icon),
    // optional count badge, and a downward tail (via CSS ::after).
    const buildPin = (o: { thumbUrl?: string; iconSvg?: string; count?: number; approx?: boolean; onClick: () => void }) => {
      const el = document.createElement('button');
      el.className = o.approx ? 'dosya-pin dosya-pin--approx' : 'dosya-pin';
      const frame = document.createElement('span');
      frame.className = 'dosya-pin__frame';
      if (o.thumbUrl) {
        // Show a shimmer skeleton until the thumbnail actually loads, then swap
        // it in. Preloading via Image() (instead of setting background-image on
        // a fresh marker node) also fixes the "blank until a theme toggle forces
        // a reflow" paint quirk — the image now appears the moment it loads.
        frame.classList.add('is-loading');
        const url = o.thumbUrl;
        const img = new Image();
        img.onload = () => { frame.style.backgroundImage = `url("${url}")`; frame.classList.remove('is-loading'); };
        img.onerror = () => { frame.classList.remove('is-loading'); };
        img.src = url;
      } else if (o.iconSvg) {
        frame.classList.add('dosya-pin__frame--icon');
        frame.innerHTML = o.iconSvg;
      }
      if (o.count && o.count > 1) {
        const c = document.createElement('span');
        c.className = 'dosya-pin__count';
        c.textContent = o.count > 999 ? `${Math.floor(o.count / 1000)}k` : String(o.count);
        frame.appendChild(c);
      }
      el.appendChild(frame);
      el.onclick = o.onClick;
      return el;
    };

    for (const item of clustersInView(index, bbox, map.getZoom())) {
      let el: HTMLButtonElement;
      if (item.kind === 'cluster') {
        const samples = item.sampleIds.map((id) => byId.get(id)).filter(Boolean) as MapPin[];
        // Prefer a real raster photo as the cover; fall back to any image, then an icon.
        const photo = samples.find(isRasterFile)
          ?? samples.find((p): p is FilePin => p.kind === 'file' && markerFor(p).type === 'thumbnail');
        const rep = photo ?? samples[0];
        el = buildPin({
          thumbUrl: photo ? pinImageUrl(photo) : undefined,
          iconSvg: photo ? undefined : rep && markerFor(rep).type === 'folder-icon' ? FOLDER_ICON_SVG : FILE_ICON_SVG,
          count: item.count,
          approx: samples.length > 0 && samples.every((p) => p.source === 'ip'),
          onClick: () => map.easeTo({ center: [item.lon, item.lat], zoom: item.expansionZoom }),
        });
      } else {
        const p = byId.get(item.pinId);
        if (!p) continue;
        const marker = markerFor(p);
        if (p.kind === 'file' && marker.type === 'thumbnail') {
          el = buildPin({ thumbUrl: pinImageUrl(p), approx: marker.approximate, onClick: () => setViewerFile(p) });
        } else {
          el = buildPin({
            iconSvg: marker.type === 'folder-icon' ? FOLDER_ICON_SVG : FILE_ICON_SVG,
            approx: marker.approximate,
            onClick: () => { if (p.kind === 'file') setViewerFile(p); else navigate(`/files?folder=${p.id}`); },
          });
        }
      }
      markersRef.current.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([item.lon, item.lat]).addTo(map));
    }
  }, [index, byId, navigate]);

  // Keep the latest renderMarkers available to effects that must not re-run on
  // every data change (the re-style effect) without listing it as a dependency.
  const renderMarkersRef = useRef(renderMarkers);
  renderMarkersRef.current = renderMarkers;

  // Init the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    ensurePmtiles();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapStyle(document.documentElement.classList.contains('dark'), false),
      center: [0, 20],
      zoom: 1.5,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    // Use the ref, not the captured closure: this handler is registered once on
    // mount, so a bare renderMarkers() would forever call the first render's
    // version (when pins were empty) and wipe markers on every pan/zoom.
    map.on('moveend', () => renderMarkersRef.current());
    // Safety: if the flex/absolute container finished sizing after init, make the
    // canvas match it (a 0-height container at init is a classic blank-map cause).
    map.once('load', () => map.resize());
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render markers when data/index changes and once the map is ready.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.loaded()) renderMarkers();
    else map.once('load', renderMarkers);
  }, [renderMarkers]);

  // Re-style only when the theme or basemap-availability actually changes vs
  // what's already applied — avoids a redundant setStyle on mount (which races
  // the initial style load and triggers "style not done loading, rebuilding from
  // scratch"). The map is initialized with buildMapStyle(initialDark, false),
  // which is exactly this ref's initial value, so the mount run is skipped.
  const appliedStyleRef = useRef({ dark, hasBasemap });
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (appliedStyleRef.current.dark === dark && appliedStyleRef.current.hasBasemap === hasBasemap) return;
    appliedStyleRef.current = { dark, hasBasemap };
    map.setStyle(buildMapStyle(dark, hasBasemap));
    map.once('styledata', () => renderMarkersRef.current());
  }, [dark, hasBasemap]);

  const countParts = [`${counts.gps} located`];
  if (counts.approximate > 0) countParts.push(`${counts.approximate} approximate`);
  if (counts.pending > 0) countParts.push(`${counts.pending} scanning…`);

  return (
    <div className="absolute inset-0 flex overflow-hidden">
      {/* The same inner files menu as the Files page, so you can jump to a
          filter / group / favourite (all of which live on Files) without
          leaving the map. The outer app rail is already always visible; this
          just restores the inner menu the full-bleed map used to cover.
          File-oriented actions route to /files since the map has no filter of
          its own. */}
      <FilesSidebar
        onFilterChange={(filter) => navigate(`/files?${filterNavParams(new URLSearchParams(), filter)}`)}
        onFavouriteClick={() => navigate('/files')}
        onGroupClick={(groupId) => navigate(`/files?${groupNavParams(new URLSearchParams(), groupId)}`)}
      />

      {/* Map area fills the remaining space. `relative` is the positioning
          context for the overlays below; `flex-1 min-w-0` gives the map a real
          size. MapLibre forces `.maplibregl-map { position: relative }`, so the
          container sizes with h-full/w-full (not inset-0) against this box. */}
      <div className="relative flex-1 min-w-0 h-full overflow-hidden">
        <div ref={containerRef} className="h-full w-full" />

      <div className="absolute top-4 left-4 z-10 flex flex-col items-start gap-2">
        {/* Count chip */}
        <div className="rounded-full bg-background/90 backdrop-blur px-3 py-1.5 text-sm shadow flex items-center gap-2">
          <MapPinIcon className="size-4 text-muted-foreground" />
          <span>{countParts.join(' · ')}</span>
        </div>

        {/* Filters: folder scope (recursive) + date range. Resetting the fit guard
            re-frames the map to the filtered pins, like Apple Photos. */}
        <MapFilterPanel
          value={filters}
          onChange={(next) => { didFitRef.current = false; setFilters(next); }}
          workspaceId={wsId}
        />

        {/* Approximate-locations filter */}
        <button
          type="button"
          onClick={() => setShowApprox((v) => !v)}
          className="rounded-full bg-background/90 backdrop-blur px-3 py-1.5 text-xs shadow flex items-center gap-2 hover:bg-muted/60"
        >
          <span className={`relative w-8 h-4.5 rounded-full transition-colors ${showApprox ? 'bg-green-600' : 'bg-muted'}`}>
            <span className={`absolute top-0.5 size-3.5 bg-white rounded-full shadow transition-all ${showApprox ? 'left-4' : 'left-0.5'}`} />
          </span>
          Show approximate locations
        </button>
      </div>

      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && visiblePins.length === 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center pointer-events-none">
          <MapPinIcon className="size-12 text-muted-foreground/30 mb-4" />
          <p className="text-sm font-medium text-muted-foreground mb-1">
            {pins.length > 0 ? 'No pins to show' : 'No files or folders with a location yet'}
          </p>
          <p className="text-xs text-muted-foreground">
            {pins.length > 0
              ? 'All located items are approximate — enable the toggle above to see them.'
              : counts.pending > 0
                ? 'Scanning your files for location…'
                : 'Files with location data, or uploaded with location capture on, will appear here.'}
          </p>
        </div>
      )}

      </div>

      {viewerFile && (
        <FileViewer
          file={viewerFile}
          files={filePins}
          workspaceId={wsId}
          onClose={() => setViewerFile(null)}
          onNavigate={(f) => setViewerFile(f as FilePin)}
          onRefresh={loadPins}
        />
      )}
    </div>
  );
}
