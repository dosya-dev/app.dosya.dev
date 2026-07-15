import Supercluster, { type PointFeature } from 'supercluster';

export type PhotoPointProps = { photoId: string };
export type PhotoFeature = PointFeature<PhotoPointProps>;

export function photosToFeatures(
  photos: { id: string; latitude: number; longitude: number }[],
): PhotoFeature[] {
  return photos.map((p) => ({
    type: 'Feature',
    properties: { photoId: p.id },
    geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
  }));
}

export function buildClusterIndex(features: PhotoFeature[]): Supercluster<PhotoPointProps> {
  const index = new Supercluster<PhotoPointProps>({ radius: 60, maxZoom: 16 });
  index.load(features);
  return index;
}

export type ViewItem =
  | { kind: 'cluster'; id: number; count: number; lon: number; lat: number; expansionZoom: number }
  | { kind: 'photo'; photoId: string; lon: number; lat: number };

export function clustersInView(
  index: Supercluster<PhotoPointProps>,
  bbox: [number, number, number, number],
  zoom: number,
): ViewItem[] {
  return index.getClusters(bbox, Math.round(zoom)).map((f) => {
    const [lon, lat] = f.geometry.coordinates as [number, number];
    const props = f.properties as PhotoPointProps & { cluster?: boolean; cluster_id?: number; point_count?: number };
    if (props.cluster) {
      const id = props.cluster_id as number;
      return {
        kind: 'cluster',
        id,
        count: props.point_count as number,
        lon,
        lat,
        expansionZoom: Math.min(index.getClusterExpansionZoom(id), 20),
      };
    }
    return { kind: 'photo', photoId: props.photoId, lon, lat };
  });
}
