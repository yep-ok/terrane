// Terrane core data model. All geometry is stored in WGS84 lon/lat (EPSG:4326)
// as GeoJSON; maps reproject for display only.
import type { Feature, Geometry } from 'geojson';

export type Id = string;

/** Generalised geometry family of a dataset (Multi* folds into its single form). null = standalone table. */
export type GeomType = 'Point' | 'LineString' | 'Polygon';
export type FieldType = 'string' | 'number' | 'integer' | 'date' | 'boolean';

export interface Field {
  name: string;
  alias?: string;
  type: FieldType;
}

/** A feature with a stable numeric id (the FID) unique within its dataset. */
export type Feat = Feature<Geometry | null, Record<string, any>> & { id: number };

export interface Dataset {
  id: Id;
  name: string;
  geomType: GeomType | null;
  fields: Field[];
  features: Feat[];
  nextFid: number;
  /** Human-readable origin, e.g. "countries.shp" or "Buffer tool". */
  source?: string;
}

// ---------- Symbology ----------

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'cross' | 'x';

/** One symbol used for any geometry type; irrelevant members are ignored. */
export interface SymbolDef {
  fill: string; // #rrggbb
  fillOpacity: number; // 0..1
  stroke: string; // #rrggbb
  strokeWidth: number; // px
  strokeOpacity?: number; // 0..1, default 1
  strokeDash?: number[];
  size: number; // point marker radius, px
  shape: MarkerShape;
}

export type ClassMethod = 'equal' | 'quantile' | 'jenks' | 'stddev' | 'manual';

export interface UniqueClass {
  value: string; // String(value); '' matches null/empty
  label: string;
  symbol: SymbolDef;
  visible?: boolean;
}
export interface RangeClass {
  min: number;
  max: number; // inclusive upper bound
  label: string;
  symbol: SymbolDef;
}

export type Renderer =
  | { type: 'single'; symbol: SymbolDef; label?: string }
  | { type: 'unique'; field: string; classes: UniqueClass[]; defaultSymbol: SymbolDef | null; ramp?: string }
  | {
      type: 'graduated';
      field: string;
      normalization?: string;
      method: ClassMethod;
      classes: RangeClass[];
      ramp: string;
      base: SymbolDef;
    }
  | {
      type: 'proportional';
      field: string;
      minValue: number;
      maxValue: number;
      minSize: number;
      maxSize: number;
      symbol: SymbolDef;
    }
  | { type: 'heatmap'; field?: string; radius: number; blur: number; ramp: string };

export interface LabelDef {
  enabled: boolean;
  /** Expression in the Terrane expression language, e.g. `NAME` or `NAME + " (" + Round(POP/1e6,1) + "M)"`. */
  expression: string;
  fontSize: number;
  fontFamily?: string;
  color: string;
  bold?: boolean;
  italic?: boolean;
  haloColor: string;
  haloWidth: number;
  offsetX?: number;
  offsetY?: number;
  minZoom?: number;
  maxZoom?: number;
  /** For lines: follow the line. */
  followLine?: boolean;
  allowOverlap?: boolean;
}

// ---------- Layers ----------

interface LayerBase {
  id: Id;
  name: string;
  visible: boolean;
  opacity: number; // 0..1
  minZoom?: number;
  maxZoom?: number;
  /** id of a GroupLayer in the same map, or null/undefined for top level. */
  parentId?: Id | null;
}

export interface PopupDef {
  title?: string; // expression
  fields?: string[]; // undefined = all
}

export interface FeatureLayer extends LayerBase {
  kind: 'feature';
  datasetId: Id;
  renderer: Renderer;
  labels: LabelDef;
  /** Where-clause in the expression language; features failing it are not drawn or listed. */
  definitionQuery?: string;
  popup?: PopupDef;
  selectable: boolean;
  editable: boolean;
}

export type TileSource =
  | { type: 'xyz'; url: string; attribution?: string; maxZoom?: number }
  | { type: 'wms'; url: string; layers: string; params?: Record<string, string>; attribution?: string }
  | { type: 'wmts'; url: string; layer: string; matrixSet?: string; attribution?: string }
  | { type: 'arcgis-tile'; url: string; attribution?: string };

export interface TileLayer extends LayerBase {
  kind: 'tile';
  source: TileSource;
}

/** GeoTIFF / image raster. Binary lives in the blob store (core/data.ts) under blobId, or at url. */
export interface RasterLayer extends LayerBase {
  kind: 'raster';
  blobId?: Id;
  url?: string;
  /** e.g. band selection / stretch; owned by the raster code. */
  options?: Record<string, any>;
}

export interface GroupLayer extends LayerBase {
  kind: 'group';
  expanded: boolean;
}

export type Layer = FeatureLayer | TileLayer | RasterLayer | GroupLayer;
export type LayerKind = Layer['kind'];

// ---------- Maps ----------

export interface ViewState {
  center: [number, number]; // lon, lat
  zoom: number;
  rotation: number; // radians
}
export interface Bookmark extends ViewState {
  id: Id;
  name: string;
}

export interface MapDoc {
  id: Id;
  name: string;
  /** Draw order: index 0 is drawn on top (as listed in Contents). */
  layers: Layer[];
  /** id from core/basemaps.ts, or null for none. */
  basemap: string | null;
  /** Display CRS code, e.g. 'EPSG:3857'. Must be registered in core/crs.ts. */
  crs: string;
  view: ViewState;
  bookmarks: Bookmark[];
}

// ---------- Layouts ----------

export type LayoutElementType = 'map' | 'text' | 'legend' | 'scalebar' | 'northarrow' | 'rect' | 'image' | 'chart';
export interface LayoutElement {
  id: Id;
  type: LayoutElementType;
  name: string;
  // page millimetres from top-left
  x: number;
  y: number;
  w: number;
  h: number;
  /** Type-specific properties; owned by features/layout. */
  props: Record<string, any>;
}
export interface LayoutDoc {
  id: Id;
  name: string;
  page: { width: number; height: number }; // mm
  elements: LayoutElement[]; // index 0 on top
}

// ---------- Charts ----------
export interface ChartDoc {
  id: Id;
  name: string;
  layerId: Id;
  mapId: Id;
  /** Type-specific config; owned by features/charts. */
  config: Record<string, any>;
}

// ---------- Project ----------

export interface Project {
  version: 1;
  name: string;
  maps: MapDoc[];
  layouts: LayoutDoc[];
  charts: ChartDoc[];
}

/** Serialised project file (.terrane): project + embedded datasets. */
export interface ProjectFile {
  format: 'terrane-project';
  project: Project;
  datasets: Dataset[];
}

export type Extent = [number, number, number, number]; // minLon, minLat, maxLon, maxLat
