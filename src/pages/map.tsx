import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { MapPin, Loader2 } from 'lucide-react';
import { useWorkspace } from '@/stores/workspace';
import { subscribeThemeChange } from '@/lib/theme';
import { fetchMapPhotos, type MapPhoto } from '@/lib/map-photos';
import { photosToFeatures, buildClusterIndex, clustersInView } from '@/lib/map-cluster';
import { buildMapStyle } from '@/lib/map-style';
import { fileThumbUrl } from '@/lib/file-url';
import { FileViewer } from '@/components/file-viewer';

let pmtilesRegistered = false;
function ensurePmtiles() {
  if (pmtilesRegistered) return;
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  pmtilesRegistered = true;
}

export default function MapPage() {
  const wsId = useWorkspace((s) => s.activeId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  const [photos, setPhotos] = useState<MapPhoto[]>([]);
  const [counts, setCounts] = useState({ geotagged: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [viewerFile, setViewerFile] = useState<MapPhoto | null>(null);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p] as const)), [photos]);
  const index = useMemo(() => buildClusterIndex(photosToFeatures(photos)), [photos]);

  const loadPhotos = useCallback(async () => {
    if (!wsId) return;
    setLoading(true);
    try {
      const data = await fetchMapPhotos(wsId);
      if (data.ok) { setPhotos(data.photos); setCounts(data.counts); }
    } catch { /* leave empty state */ }
    setLoading(false);
  }, [wsId]);

  useEffect(() => { loadPhotos(); }, [loadPhotos]);
  useEffect(() => subscribeThemeChange(() => setDark(document.documentElement.classList.contains('dark'))), []);

  // Render cluster/photo markers for the current viewport.
  const renderMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    const b = map.getBounds();
    const bbox: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    for (const item of clustersInView(index, bbox, map.getZoom())) {
      const el = document.createElement('button');
      el.className = 'dosya-map-marker';
      if (item.kind === 'cluster') {
        el.innerHTML = `<span class="dosya-map-count">${item.count}</span>`;
        el.onclick = () => map.easeTo({ center: [item.lon, item.lat], zoom: item.expansionZoom });
      } else {
        const p = byId.get(item.photoId);
        if (p) {
          const img = document.createElement('img');
          img.src = fileThumbUrl({ fileId: p.id, size: 128 });
          img.loading = 'lazy';
          el.appendChild(img);
          el.onclick = () => setViewerFile(p);
        }
      }
      markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([item.lon, item.lat]).addTo(map));
    }
  }, [index, byId]);

  // Init the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    ensurePmtiles();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapStyle(document.documentElement.classList.contains('dark')),
      center: [0, 20],
      zoom: 1.5,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('moveend', () => renderMarkers());
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

  // Re-style on theme change, then re-add markers after the new style loads.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(buildMapStyle(dark));
    map.once('styledata', () => renderMarkers());
  }, [dark, renderMarkers]);

  return (
    <div className="h-full w-full relative overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Count chip */}
      <div className="absolute top-4 left-4 z-10 rounded-full bg-background/90 backdrop-blur px-3 py-1.5 text-sm shadow flex items-center gap-2">
        <MapPin className="size-4 text-muted-foreground" />
        <span>{counts.geotagged} photos{counts.pending > 0 ? ` · ${counts.pending} scanning…` : ''}</span>
      </div>

      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && counts.geotagged === 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center pointer-events-none">
          <MapPin className="size-12 text-muted-foreground/30 mb-4" />
          <p className="text-sm font-medium text-muted-foreground mb-1">No photos with location yet</p>
          <p className="text-xs text-muted-foreground">
            {counts.pending > 0 ? 'Scanning your photos for location…' : 'Photos taken with location services on will appear here.'}
          </p>
        </div>
      )}

      {viewerFile && (
        <FileViewer
          file={viewerFile}
          files={photos}
          workspaceId={wsId}
          onClose={() => setViewerFile(null)}
          onNavigate={(f) => setViewerFile(f as MapPhoto)}
          onRefresh={loadPhotos}
        />
      )}
    </div>
  );
}
