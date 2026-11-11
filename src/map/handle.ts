// MapHandle: the imperative API of a live map view. Tools and commands use this
// instead of touching React. Obtain with getMapHandle() (active map by default).
import type OlMap from 'ol/Map';
import type BaseLayer from 'ol/layer/Base';
import type VectorSource from 'ol/source/Vector';
import type OlFeature from 'ol/Feature';
import type { FeatureLike } from 'ol/Feature';
import type { Coordinate } from 'ol/coordinate';
import type { Pixel } from 'ol/pixel';
import type { Geometry } from 'geojson';
import type { Extent, Feat, Id, ViewState } from '../core/types';
import { useUi } from '../core/ui';

export interface Hit {
  layerId: Id;
  fid: number;
  feat: Feat;
  olFeature: OlFeature;
}

export interface MapHandle {
  readonly mapId: Id;
  readonly map: OlMap;
  /** Current display CRS code of the view. */
  readonly crs: string;
  /** Source of a top-most overlay layer for temporary tool graphics (in map CRS). Clear what you add. */
  readonly scratch: VectorSource;

  olLayer(layerId: Id): BaseLayer | undefined;
  /** Vector source of a feature layer. Its OL features carry get('feat') (the Feat) and get('layerId'). */
  source(layerId: Id): VectorSource | undefined;

  toMap(lonLat: number[]): Coordinate;
  toLonLat(coord: Coordinate): [number, number];
  /** GeoJSON geometry (EPSG:4326) from an OL geometry in the map CRS, and back. */
  toGeoJSON(geom: import('ol/geom/Geometry').default): Geometry;
  fromGeoJSON(geom: Geometry): import('ol/geom/Geometry').default;

  getViewState(): ViewState;
  setViewState(view: Partial<ViewState>, animate?: boolean): void;
  /** Visible extent as a lon/lat bounding box. */
  getExtent(): Extent;
  zoomToExtent(extent: Extent | null | undefined, opts?: { padding?: number; maxZoom?: number; animate?: boolean }): void;
  zoomToLayer(layerId: Id): void;
  zoomToFeatures(layerId: Id, fids: number[]): void;
  /** Zoom to all selected features of the map (or one layer). */
  zoomToSelection(layerId?: Id): void;
  /** Zoom to the extent of all feature layers. */
  zoomFull(): void;
  /** Map scale denominator at the view centre (1:n), and its setter. */
  getScale(): number;
  setScale(denominator: number): void;

  /** Features under a pixel, top-most first. Only visible feature layers (selectable ones unless includeUnselectable). */
  hitTest(pixel: Pixel, opts?: { tolerance?: number; layerIds?: Id[]; includeUnselectable?: boolean }): Hit[];
  /** Briefly highlight geometries (EPSG:4326). */
  flash(geometries: Array<Geometry | null | undefined>): void;
  /** Enable/disable left-drag panning (tools that need plain drags turn it off; middle-drag always pans). */
  setDragPan(enabled: boolean): void;
  /** Render the current view to a canvas (for export). Resolves after rendering completes. */
  toCanvas(): Promise<HTMLCanvasElement>;
}

const handles = new Map<Id, MapHandle>();
export function registerMapHandle(h: MapHandle) {
  handles.set(h.mapId, h);
}
export function unregisterMapHandle(h: MapHandle) {
  if (handles.get(h.mapId) === h) handles.delete(h.mapId);
}
/** Live handle for a map view, defaulting to the active map. Undefined if that map has no open view. */
export function getMapHandle(mapId?: Id | null): MapHandle | undefined {
  const id = mapId ?? useUi.getState().activeMapId;
  return id ? handles.get(id) : undefined;
}

/** The Terrane feature behind an OL feature created by the map runtime. */
export const featOf = (f: FeatureLike): Feat | undefined => f.get('feat');
export const layerIdOf = (f: FeatureLike): Id | undefined => f.get('layerId');
