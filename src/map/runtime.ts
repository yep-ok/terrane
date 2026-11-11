// MapRuntime: binds one OpenLayers map to a MapDoc in the project store.
// Framework-free so it can back both the interactive MapView and layout map frames.
import OlMap from 'ol/Map';
import View from 'ol/View';
import OlFeature from 'ol/Feature';
import GeoJSON from 'ol/format/GeoJSON';
import type BaseLayer from 'ol/layer/Base';
import TileLayer from 'ol/layer/Tile';
import WebGLTileLayer from 'ol/layer/WebGLTile';
import VectorLayer from 'ol/layer/Vector';
import HeatmapLayer from 'ol/layer/Heatmap';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import TileWMS from 'ol/source/TileWMS';
import GeoTIFFSource from 'ol/source/GeoTIFF';
import type TileSourceBase from 'ol/source/Tile';
import { ScaleLine, Attribution, Rotate } from 'ol/control';
import { DragPan, defaults as defaultInteractions } from 'ol/interaction';
import { fromLonLat, getPointResolution, toLonLat, transformExtent, get as getProjection } from 'ol/proj';
import { isEmpty as extentIsEmpty, createEmpty, extend as extendExtent } from 'ol/extent';
import { Fill, Stroke, Style, Circle } from 'ol/style';
import type { Coordinate } from 'ol/coordinate';
import type { Pixel } from 'ol/pixel';
import type OlGeometry from 'ol/geom/Geometry';
import type { Geometry } from 'geojson';

import type { Dataset, Extent, Feat, FeatureLayer, Id, Layer, MapDoc, TileSource, ViewState } from '../core/types';
import { datasetExtent, featureById, featuresExtent, getBlob, getDataset, subscribeData, type DataEvent } from '../core/data';
import { isLayerVisible, setView, useProject } from '../core/store';
import { useUi } from '../core/ui';
import { ensureCrs, ensureCrsSync, isCrsRegistered } from '../core/crs';
import { getBasemap } from '../core/basemaps';
import { tryCompile } from '../core/expr';
import { makeStyleFunction, selectionStyles, type FeatStyleFn } from './style';
import { getRamp, rampColors } from '../features/symbology/ramps';
import { registerMapHandle, unregisterMapHandle, type Hit, type MapHandle } from './handle';

const INCHES_PER_METRE = 39.37007874;
const DPI = 96;
const geojson = new GeoJSON();

export function createTileSource(src: TileSource): TileSourceBase {
  const common = { crossOrigin: 'anonymous' as const, attributions: src.attribution ? [src.attribution] : undefined };
  switch (src.type) {
    case 'xyz':
      return new XYZ({ ...common, url: src.url, maxZoom: src.maxZoom ?? 19 });
    case 'arcgis-tile':
      return new XYZ({ ...common, url: src.url.replace(/\/+$/, '') + '/tile/{z}/{y}/{x}' });
    case 'wms':
      return new TileWMS({ ...common, url: src.url, params: { LAYERS: src.layers, TILED: true, TRANSPARENT: true, FORMAT: 'image/png', ...src.params } });
    case 'wmts': {
      const url = src.url.includes('{z}')
        ? src.url
        : `${src.url}${src.url.includes('?') ? '&' : '?'}SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${encodeURIComponent(src.layer)}&STYLE=default&TILEMATRIXSET=${encodeURIComponent(src.matrixSet ?? 'GoogleMapsCompatible')}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png`;
      return new XYZ({ ...common, url });
    }
  }
}

interface Entry {
  layer: Layer;
  ol: BaseLayer;
  structKey: string;
  source?: VectorSource;
  datasetId?: Id;
  selected: Set<number>;
}

export interface MapRuntimeOptions {
  mapId: Id;
  target: HTMLElement;
  /** Default true. False = static map (layout frames): no interactions, no store/UI feedback, not registered as the map's handle. */
  interactive?: boolean;
  /** Initial view override (defaults to the MapDoc's view). */
  view?: ViewState;
  pixelRatio?: number;
  /** Draw selection highlights (default: same as interactive). */
  showSelection?: boolean;
  onViewChange?(view: ViewState): void;
}

export class MapRuntime implements MapHandle {
  readonly mapId: Id;
  readonly map: OlMap;
  readonly scratch = new VectorSource();
  crs: string;

  private interactive: boolean;
  private showSelection: boolean;
  private entries = new Map<Id, Entry>();
  private basemapLayer: TileLayer | null = null;
  private basemapId: string | null | undefined = undefined;
  private lastLayers: Layer[] | null = null;
  private dragPan: DragPan | null = null;
  private unsubs: Array<() => void> = [];
  private destroyed = false;
  private opts: MapRuntimeOptions;
  private flashTimer: any = null;
  private flashSource = new VectorSource();

  constructor(opts: MapRuntimeOptions) {
    this.opts = opts;
    this.mapId = opts.mapId;
    this.interactive = opts.interactive !== false;
    this.showSelection = opts.showSelection ?? this.interactive;
    const doc = this.doc();
    this.crs = doc && ensureCrsSync(doc.crs) ? doc.crs : 'EPSG:3857';
    const view = opts.view ?? doc?.view ?? { center: [0, 20], zoom: 2, rotation: 0 };

    const interactions = this.interactive
      ? defaultInteractions({ shiftDragZoom: false, dragPan: false, doubleClickZoom: false })
      : defaultInteractions({ dragPan: false, mouseWheelZoom: false, doubleClickZoom: false, shiftDragZoom: false, altShiftDragRotate: false, keyboard: false, pinchRotate: false, pinchZoom: false });

    this.map = new OlMap({
      target: opts.target,
      pixelRatio: opts.pixelRatio,
      controls: this.interactive
        ? [new ScaleLine({ units: 'metric' }), new Attribution({ collapsible: true, collapsed: true }), new Rotate()]
        : [],
      interactions,
      view: this.makeView(view),
      layers: [
        new VectorLayer({
          source: this.scratch,
          zIndex: 100000,
          properties: { role: 'scratch' },
          style: new Style({
            stroke: new Stroke({ color: '#ffb300', width: 2 }),
            fill: new Fill({ color: 'rgba(255,179,0,0.15)' }),
            image: new Circle({ radius: 5, fill: new Fill({ color: '#ffb300' }), stroke: new Stroke({ color: '#fff', width: 1.5 }) }),
          }),
        }),
        new VectorLayer({
          source: this.flashSource,
          zIndex: 100001,
          properties: { role: 'flash' },
          style: new Style({
            stroke: new Stroke({ color: '#00e676', width: 4 }),
            fill: new Fill({ color: 'rgba(0,230,118,0.35)' }),
            image: new Circle({ radius: 9, fill: new Fill({ color: 'rgba(0,230,118,0.6)' }), stroke: new Stroke({ color: '#00e676', width: 3 }) }),
          }),
        }),
      ],
    });

    if (this.interactive) {
      // Left-drag pan (tools can disable) + middle-drag pan (always available).
      this.dragPan = new DragPan({ condition: (e) => (e.originalEvent as PointerEvent).button === 0 && !e.originalEvent.shiftKey && !e.originalEvent.altKey });
      this.map.addInteraction(this.dragPan);
      this.map.addInteraction(new DragPan({ condition: (e) => (e.originalEvent as PointerEvent).button === 1 }));

      this.map.on('moveend', () => {
        const v = this.getViewState();
        setView(this.mapId, v);
        this.opts.onViewChange?.(v);
        if (useUi.getState().activeMapId === this.mapId) useUi.setState({ scale: this.getScale() });
      });
      let raf = 0;
      this.map.on('pointermove', (e) => {
        if (raf) return;
        const coord = e.coordinate;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const [lon, lat] = this.toLonLat(coord);
          if (Number.isFinite(lon) && Number.isFinite(lat)) useUi.setState({ cursor: { lon, lat } });
        });
      });
      opts.target.addEventListener('contextmenu', (e) => e.preventDefault());
      registerMapHandle(this);
    } else if (opts.onViewChange) {
      this.map.on('moveend', () => this.opts.onViewChange?.(this.getViewState()));
    }

    this.sync();
    this.unsubs.push(useProject.subscribe(() => this.sync()));
    this.unsubs.push(subscribeData((e) => this.onData(e)));
    if (this.showSelection) {
      this.applySelection(useUi.getState().selection);
      this.unsubs.push(useUi.subscribe((s, prev) => s.selection !== prev.selection && this.applySelection(s.selection)));
    }
    if (doc && !isCrsRegistered(doc.crs)) ensureCrs(doc.crs).then((ok) => ok && !this.destroyed && this.sync());
  }

  destroy() {
    this.destroyed = true;
    this.unsubs.forEach((u) => u());
    unregisterMapHandle(this);
    clearTimeout(this.flashTimer);
    this.map.setTarget(undefined);
    this.map.dispose();
  }

  private doc(): MapDoc | undefined {
    return useProject.getState().project.maps.find((m) => m.id === this.mapId);
  }

  private makeView(v: ViewState): View {
    const proj = getProjection(this.crs)!;
    return new View({
      projection: proj,
      center: fromLonLat(v.center, proj),
      zoom: v.zoom,
      rotation: v.rotation,
      maxZoom: 24,
      minZoom: 0,
      constrainResolution: false,
      enableRotation: true,
      smoothExtentConstraint: true,
      showFullExtent: true,
    });
  }

  // ---------- store -> OL ----------

  private sync() {
    if (this.destroyed) return;
    const doc = this.doc();
    if (!doc) return;

    if (doc.crs !== this.crs && isCrsRegistered(doc.crs)) {
      const v = this.getViewState();
      const extent = this.getExtent();
      this.crs = doc.crs;
      this.map.setView(this.makeView(v));
      for (const e of this.entries.values()) if (e.source) this.loadFeatures(e);
      this.scratch.clear();
      this.zoomToExtent(extent, { padding: 0, animate: false });
    } else if (doc.crs !== this.crs) {
      ensureCrs(doc.crs).then((ok) => ok && !this.destroyed && this.sync());
    }

    if (doc.basemap !== this.basemapId) {
      this.basemapId = doc.basemap;
      if (this.basemapLayer) this.map.removeLayer(this.basemapLayer);
      const bm = getBasemap(doc.basemap);
      this.basemapLayer = bm ? new TileLayer({ source: createTileSource(bm.source), zIndex: -1, properties: { role: 'basemap' } }) : null;
      if (this.basemapLayer && bm?.filter) {
        const filter = bm.filter;
        this.basemapLayer.on('prerender', (e) => { (e.context as CanvasRenderingContext2D).filter = filter; });
        this.basemapLayer.on('postrender', (e) => { (e.context as CanvasRenderingContext2D).filter = 'none'; });
      }
      if (this.basemapLayer) this.map.addLayer(this.basemapLayer);
    }

    if (doc.layers === this.lastLayers) return;
    this.lastLayers = doc.layers;
    const alive = new Set<Id>();
    const n = doc.layers.length;
    doc.layers.forEach((layer, i) => {
      if (layer.kind === 'group') return;
      alive.add(layer.id);
      const structKey = this.structKey(layer);
      let entry = this.entries.get(layer.id);
      if (entry && entry.structKey !== structKey) {
        this.map.removeLayer(entry.ol);
        entry.ol.dispose?.();
        this.entries.delete(layer.id);
        entry = undefined;
      }
      if (!entry) {
        const created = this.createEntry(layer, structKey);
        if (!created) return;
        entry = created;
        this.entries.set(layer.id, entry);
        this.map.addLayer(entry.ol);
      } else if (entry.layer !== layer) {
        const prev = entry.layer;
        entry.layer = layer;
        if (layer.kind === 'feature' && prev.kind === 'feature') {
          if (prev.definitionQuery !== layer.definitionQuery) this.loadFeatures(entry);
          if (prev.renderer !== layer.renderer || prev.labels !== layer.labels) this.applyStyle(entry);
        }
      }
      entry.ol.setVisible(isLayerVisible(doc, layer));
      entry.ol.setOpacity(layer.opacity);
      entry.ol.setZIndex(n - i);
      entry.ol.setMinZoom(layer.minZoom ?? -Infinity);
      entry.ol.setMaxZoom(layer.maxZoom ?? Infinity);
    });
    for (const [id, entry] of this.entries) {
      if (!alive.has(id)) {
        this.map.removeLayer(entry.ol);
        entry.ol.dispose?.();
        this.entries.delete(id);
      }
    }
  }

  private structKey(layer: Layer): string {
    switch (layer.kind) {
      case 'feature':
        return layer.renderer.type === 'heatmap'
          ? `heat|${layer.datasetId}|${JSON.stringify(layer.renderer)}`
          : `vec|${layer.datasetId}`;
      case 'tile':
        return 'tile|' + JSON.stringify(layer.source);
      case 'raster':
        return `raster|${layer.blobId ?? ''}|${layer.url ?? ''}|${JSON.stringify(layer.options ?? {})}`;
      default:
        return 'group';
    }
  }

  private createEntry(layer: Layer, structKey: string): Entry | null {
    const props = { layerId: layer.id };
    if (layer.kind === 'tile') {
      return { layer, structKey, selected: new Set(), ol: new TileLayer({ source: createTileSource(layer.source), properties: props }) };
    }
    if (layer.kind === 'raster') {
      const blob = getBlob(layer.blobId);
      if (!blob && !layer.url) return null;
      const source = new GeoTIFFSource({ sources: [blob ? { blob } : { url: layer.url! }], ...(layer.options?.source ?? {}) });
      return { layer, structKey, selected: new Set(), ol: new WebGLTileLayer({ source, properties: props, ...(layer.options?.layer ?? {}) }) };
    }
    if (layer.kind === 'feature') {
      const ds = getDataset(layer.datasetId);
      if (!ds) return null;
      const source = new VectorSource();
      let ol: BaseLayer;
      if (layer.renderer.type === 'heatmap') {
        const r = layer.renderer;
        let max = 0;
        if (r.field) for (const f of ds.features) max = Math.max(max, Number(f.properties[r.field]) || 0);
        ol = new HeatmapLayer({
          source,
          properties: props,
          radius: r.radius,
          blur: r.blur,
          gradient: getRamp(r.ramp).kind === 'qualitative' ? rampColors('Heat', 5) : getRamp(r.ramp).colors,
          weight: (f) => (r.field && max > 0 ? Math.max(0, Number((f.get('feat') as Feat)?.properties[r.field!]) || 0) / max : 1),
        });
      } else {
        ol = new VectorLayer({ source, properties: props, declutter: true, updateWhileAnimating: false, updateWhileInteracting: false });
      }
      const entry: Entry = { layer, structKey, ol, source, datasetId: ds.id, selected: new Set(useUi.getState().selection[layer.id] ?? []) };
      this.loadFeatures(entry);
      this.applyStyle(entry);
      return entry;
    }
    return null;
  }

  private toOl(feat: Feat, layerId: Id): OlFeature {
    const f = new OlFeature();
    if (feat.geometry) {
      try {
        f.setGeometry(geojson.readGeometry(feat.geometry, { dataProjection: 'EPSG:4326', featureProjection: this.crs }));
      } catch {}
    }
    f.setId(feat.id);
    f.set('feat', feat, true);
    f.set('layerId', layerId, true);
    return f;
  }

  private filterFor(layer: FeatureLayer): ((f: Feat) => boolean) | null {
    if (!layer.definitionQuery?.trim()) return null;
    const { fn } = tryCompile(layer.definitionQuery);
    return fn ? (f) => !!fn(f) : null;
  }

  private loadFeatures(entry: Entry) {
    const layer = entry.layer as FeatureLayer;
    const ds = getDataset(layer.datasetId);
    if (!entry.source) return;
    entry.source.clear(true);
    if (!ds) return;
    const filter = this.filterFor(layer);
    const feats = filter ? ds.features.filter(filter) : ds.features;
    entry.source.addFeatures(feats.map((f) => this.toOl(f, layer.id)));
  }

  private applyStyle(entry: Entry) {
    const layer = entry.layer as FeatureLayer;
    const ds = getDataset(layer.datasetId);
    if (!ds || !(entry.ol instanceof VectorLayer)) return;
    let base: FeatStyleFn;
    try {
      base = makeStyleFunction(layer, ds);
    } catch (err) {
      console.error('style error', err);
      base = () => undefined;
    }
    if (!this.showSelection) {
      entry.ol.setStyle(base as any);
      return;
    }
    const size = layer.renderer.type === 'single' ? layer.renderer.symbol.size : 6;
    const sel = selectionStyles(ds.geomType, size);
    const selected = entry.selected;
    entry.ol.setStyle(((f: any, res: number) => {
      const s = base(f, res);
      if (!selected.size || !selected.has(f.getId() as number)) return s;
      return s ? (Array.isArray(s) ? [...s, ...sel] : [s, ...sel]) : sel;
    }) as any);
  }

  private onData(e: DataEvent) {
    if (this.destroyed) return;
    for (const entry of this.entries.values()) {
      if (entry.datasetId !== e.datasetId || !entry.source) continue;
      const layer = entry.layer as FeatureLayer;
      if (e.type === 'edit') {
        const src = entry.source;
        const filter = this.filterFor(layer);
        for (const id of e.deletes) {
          const f = src.getFeatureById(id);
          if (f) src.removeFeature(f as OlFeature);
        }
        for (const id of [...e.updates, ...e.adds]) {
          const feat = featureById(e.datasetId, id);
          const existing = src.getFeatureById(id) as OlFeature | null;
          const pass = feat && (!filter || filter(feat));
          if (!pass) {
            if (existing) src.removeFeature(existing);
            continue;
          }
          if (existing) {
            const prev: Feat | undefined = existing.get('feat');
            existing.set('feat', feat, true);
            if (!prev || prev.geometry !== feat.geometry) {
              existing.setGeometry(feat.geometry ? geojson.readGeometry(feat.geometry, { dataProjection: 'EPSG:4326', featureProjection: this.crs }) : undefined);
            } else existing.changed();
          } else src.addFeature(this.toOl(feat, layer.id));
        }
      } else if (e.type === 'reset' || e.type === 'schema') {
        this.loadFeatures(entry);
        this.applyStyle(entry);
      }
    }
  }

  private applySelection(selection: Record<Id, number[]>) {
    for (const [id, entry] of this.entries) {
      if (!entry.source) continue;
      const next = selection[id];
      if (!next && !entry.selected.size) continue;
      entry.selected.clear();
      if (next) for (const fid of next) entry.selected.add(fid);
      entry.ol.changed();
    }
  }

  // ---------- MapHandle ----------

  olLayer(layerId: Id) {
    return this.entries.get(layerId)?.ol;
  }
  source(layerId: Id) {
    return this.entries.get(layerId)?.source;
  }
  toMap(lonLat: number[]): Coordinate {
    return fromLonLat(lonLat, this.crs);
  }
  toLonLat(coord: Coordinate): [number, number] {
    const p = toLonLat(coord, this.crs);
    return [p[0], p[1]];
  }
  toGeoJSON(geom: OlGeometry): Geometry {
    return geojson.writeGeometryObject(geom, { dataProjection: 'EPSG:4326', featureProjection: this.crs, decimals: 8 }) as Geometry;
  }
  fromGeoJSON(geom: Geometry): OlGeometry {
    return geojson.readGeometry(geom, { dataProjection: "EPSG:4326", featureProjection: this.crs }) as OlGeometry;
  }

  getViewState(): ViewState {
    const v = this.map.getView();
    const c = this.toLonLat(v.getCenter() ?? [0, 0]);
    return { center: c, zoom: v.getZoom() ?? 2, rotation: v.getRotation() };
  }
  setViewState(view: Partial<ViewState>, animate = true) {
    const v = this.map.getView();
    const target: any = {};
    if (view.center) target.center = this.toMap(view.center);
    if (view.zoom !== undefined) target.zoom = view.zoom;
    if (view.rotation !== undefined) target.rotation = view.rotation;
    if (animate) v.animate({ ...target, duration: 450 });
    else {
      if (target.center) v.setCenter(target.center);
      if (target.zoom !== undefined) v.setZoom(target.zoom);
      if (target.rotation !== undefined) v.setRotation(target.rotation);
    }
  }
  getExtent(): Extent {
    const size = this.map.getSize();
    const e = this.map.getView().calculateExtent(size && size[0] > 0 ? size : [800, 600]);
    const out = transformExtent(e, this.crs, 'EPSG:4326', 8);
    return [Math.max(-180, out[0]), Math.max(-90, out[1]), Math.min(180, out[2]), Math.min(90, out[3])];
  }
  zoomToExtent(extent: Extent | null | undefined, opts: { padding?: number; maxZoom?: number; animate?: boolean } = {}) {
    if (!extent || !extent.every(Number.isFinite)) return;
    let e: number[];
    try {
      e = transformExtent(extent, 'EPSG:4326', this.crs, 8);
    } catch {
      return;
    }
    if (!e.every(Number.isFinite)) {
      const pe = getProjection(this.crs)?.getExtent();
      if (!pe) return;
      e = pe;
    }
    const pad = opts.padding ?? 40;
    const size = this.map.getSize();
    if (!size || size[0] === 0) this.map.updateSize();
    this.map.getView().fit(e, {
      padding: [pad, pad, pad, pad],
      maxZoom: opts.maxZoom ?? 17,
      duration: opts.animate === false ? 0 : 450,
    });
  }
  zoomToLayer(layerId: Id) {
    const entry = this.entries.get(layerId);
    if (entry?.source) {
      const e = entry.source.getExtent();
      if (e && !extentIsEmpty(e)) this.map.getView().fit(e, { padding: [40, 40, 40, 40], maxZoom: 17, duration: 450 });
      return;
    }
    if (entry?.ol instanceof WebGLTileLayer) {
      const src = entry.ol.getSource();
      src?.getView().then((v: any) => v?.extent && this.map.getView().fit(transformExtent(v.extent, v.projection ?? this.crs, this.crs), { duration: 450 }));
    }
  }
  zoomToFeatures(layerId: Id, fids: number[]) {
    const layer = this.entries.get(layerId)?.layer;
    if (!layer || layer.kind !== 'feature') return;
    const feats = fids.map((id) => featureById(layer.datasetId, id)).filter(Boolean) as Feat[];
    this.zoomToExtent(featuresExtent(feats), { maxZoom: 15 });
  }
  zoomToSelection(layerId?: Id) {
    const selection = useUi.getState().selection;
    const feats: Feat[] = [];
    for (const [id, entry] of this.entries) {
      if (layerId && id !== layerId) continue;
      if (entry.layer.kind !== 'feature') continue;
      for (const fid of selection[id] ?? []) {
        const f = featureById(entry.layer.datasetId, fid);
        if (f) feats.push(f);
      }
    }
    this.zoomToExtent(featuresExtent(feats), { maxZoom: 15 });
  }
  zoomFull() {
    const ext = createEmpty();
    for (const entry of this.entries.values()) {
      if (!entry.source || !entry.ol.getVisible()) continue;
      const e = entry.source.getExtent();
      if (e && !extentIsEmpty(e)) extendExtent(ext, e);
    }
    if (!extentIsEmpty(ext)) this.map.getView().fit(ext, { padding: [40, 40, 40, 40], maxZoom: 17, duration: 450 });
    else this.setViewState({ center: [0, 20], zoom: 2.2 });
  }
  getScale(): number {
    const v = this.map.getView();
    const res = v.getResolution();
    const center = v.getCenter();
    if (!res || !center) return 0;
    const metres = getPointResolution(v.getProjection(), res, center, 'm');
    return metres * INCHES_PER_METRE * DPI;
  }
  setScale(denominator: number) {
    const cur = this.getScale();
    const v = this.map.getView();
    const res = v.getResolution();
    if (!cur || !res || !(denominator > 0)) return;
    v.animate({ resolution: (res * denominator) / cur, duration: 300 });
  }

  hitTest(pixel: Pixel, opts: { tolerance?: number; layerIds?: Id[]; includeUnselectable?: boolean } = {}): Hit[] {
    const hits: Hit[] = [];
    const seen = new Set<string>();
    this.map.forEachFeatureAtPixel(
      pixel,
      (f, l) => {
        const layerId: Id | undefined = l?.get('layerId');
        const feat: Feat | undefined = f.get('feat');
        if (!layerId || !feat) return;
        const key = layerId + ':' + feat.id;
        if (seen.has(key)) return;
        seen.add(key);
        hits.push({ layerId, fid: feat.id, feat, olFeature: f as OlFeature });
      },
      {
        hitTolerance: opts.tolerance ?? 4,
        layerFilter: (l) => {
          const id: Id | undefined = l.get('layerId');
          if (!id) return false;
          if (opts.layerIds && !opts.layerIds.includes(id)) return false;
          const layer = this.entries.get(id)?.layer;
          return !!layer && layer.kind === 'feature' && (opts.includeUnselectable || layer.selectable);
        },
      },
    );
    return hits;
  }

  flash(geometries: Array<Geometry | null | undefined>) {
    this.flashSource.clear();
    for (const g of geometries) {
      if (!g) continue;
      try {
        this.flashSource.addFeature(new OlFeature(this.fromGeoJSON(g)));
      } catch {}
    }
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flashSource.clear(), 900);
  }

  setDragPan(enabled: boolean) {
    this.dragPan?.setActive(enabled);
  }

  toCanvas(): Promise<HTMLCanvasElement> {
    return new Promise((resolve) => {
      this.map.once('rendercomplete', () => resolve(composeMapCanvas(this.map)));
      this.map.renderSync();
    });
  }

  /** Dataset behind a feature layer of this map. */
  datasetOf(layerId: Id): Dataset | undefined {
    const l = this.entries.get(layerId)?.layer;
    return l?.kind === 'feature' ? getDataset(l.datasetId) : undefined;
  }
  layerExtent(layerId: Id): Extent | null {
    const l = this.entries.get(layerId)?.layer;
    return l?.kind === 'feature' ? datasetExtent(l.datasetId) : null;
  }
}

/** Flatten all of an OL map's layer canvases into one canvas (device pixels). */
export function composeMapCanvas(map: OlMap): HTMLCanvasElement {
  const size = map.getSize() ?? [1, 1];
  const out = document.createElement('canvas');
  const viewport = map.getViewport()!;
  const canvases = Array.from(viewport.querySelectorAll<HTMLCanvasElement>('.ol-layer canvas, canvas.ol-layer'));
  const ratio = canvases[0] && canvases[0].width ? canvases[0].width / (parseFloat(canvases[0].style.width) || size[0]) : window.devicePixelRatio;
  out.width = Math.round(size[0] * ratio);
  out.height = Math.round(size[1] * ratio);
  const ctx = out.getContext('2d')!;
  for (const canvas of canvases) {
    if (!canvas.width) continue;
    const parent = canvas.parentElement as HTMLElement | null;
    const opacity = parent?.style.opacity || canvas.style.opacity;
    ctx.globalAlpha = opacity === '' || opacity == null ? 1 : Number(opacity);
    const transform = canvas.style.transform;
    const m = /^matrix\(([^)]*)\)$/.exec(transform);
    if (m) {
      const [a, b, c, d, e, f] = m[1].split(',').map(Number);
      ctx.setTransform(a, b, c, d, e, f);
    } else {
      ctx.setTransform(parseFloat(canvas.style.width) / canvas.width * ratio || 1, 0, 0, parseFloat(canvas.style.height) / canvas.height * ratio || 1, 0, 0);
    }
    const bg = parent?.style.backgroundColor;
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    try {
      ctx.drawImage(canvas, 0, 0);
    } catch {}
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return out;
}
