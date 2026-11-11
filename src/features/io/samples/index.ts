// Sample datasets and the starter project. Store side effects; data itself is in ./data.
import { feature } from 'topojson-client';
import { area } from '@turf/turf';
import countriesUrl from 'world-atlas/countries-50m.json?url';
import type { Feature } from 'geojson';
import { allDatasets, createDataset, datasetExtent } from '../../../core/data';
import { addLayer, addMap, defaultSymbol, makeFeatureLayer, newProject, markSaved, updateLayer } from '../../../core/store';
import { openView, resetSession, setActiveLayer } from '../../../core/ui';
import type { Dataset, FeatureLayer, Id, SymbolDef, UniqueClass } from '../../../core/types';
import { addDatasetToMap, ensureActiveMap, fetchBuffer, zoomToExtentWhenReady } from '../importer';
import { CITY_COUNT, CONTINENTS, cityFeatures, continentOf, graticuleFeatures, referenceLineFeatures } from './data';

export type SampleId = 'countries' | 'cities' | 'graticule' | 'reference';

export interface SampleInfo {
  id: SampleId;
  title: string;
  description: string;
}

export const SAMPLES: SampleInfo[] = [
  { id: 'countries', title: 'World countries', description: '241 polygons with NAME, CONTINENT, ISO_N3 and AREA_KM2 (Natural Earth 1:50m via world-atlas).' },
  { id: 'cities', title: 'World cities', description: `${CITY_COUNT} major cities with COUNTRY, POP_EST and a CAPITAL flag.` },
  { id: 'graticule', title: 'Graticule (10 degrees)', description: 'Meridians and parallels every 10 degrees.' },
  { id: 'reference', title: 'Reference lines', description: 'Equator, tropics, polar circles, prime meridian and antimeridian.' },
];

let countriesCache: Feature[] | null = null;

/**
 * Rings that cross the antimeridian jump from +180 to -180, which draws a band
 * across the whole map in planar projections. Make each ring continuous instead
 * (longitudes may then run past ±180, which the map handles).
 */
function unwrapAntimeridian(geometry: any): any {
  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return geometry;
  const fixRing = (ring: number[][]) => {
    let offset = 0;
    let changed = false;
    const out = ring.map((p, i) => {
      if (i > 0) {
        const d = p[0] - ring[i - 1][0];
        if (d > 180) offset -= 360;
        else if (d < -180) offset += 360;
      }
      if (offset) changed = true;
      return offset ? [p[0] + offset, p[1]] : p;
    });
    return changed ? out : ring;
  };
  const fixPoly = (poly: number[][][]) => poly.map(fixRing);
  return geometry.type === 'Polygon'
    ? { ...geometry, coordinates: fixPoly(geometry.coordinates) }
    : { ...geometry, coordinates: geometry.coordinates.map(fixPoly) };
}

export async function loadCountryFeatures(): Promise<Feature[]> {
  if (countriesCache) return countriesCache;
  const buf = await fetchBuffer(countriesUrl);
  const topo = JSON.parse(new TextDecoder().decode(buf));
  const fc: any = feature(topo, topo.objects.countries);
  countriesCache = (fc.features as any[]).map((f) => {
    const name: string = f.properties?.name ?? 'Unknown';
    let km2 = 0;
    try {
      km2 = Math.round(area(f) / 1e6);
    } catch {
      /* leave 0 */
    }
    return {
      type: 'Feature',
      geometry: unwrapAntimeridian(f.geometry),
      properties: { NAME: name, CONTINENT: continentOf(f.id, name), ISO_N3: f.id === undefined ? null : String(f.id).padStart(3, '0'), AREA_KM2: km2 },
    } as Feature;
  });
  return countriesCache;
}

const SOURCE: Record<SampleId, string> = {
  countries: 'Sample data (Natural Earth 1:50m, world-atlas)',
  cities: 'Sample data (authored; populations approximate)',
  graticule: 'Sample data (generated)',
  reference: 'Sample data (generated)',
};
const NAME: Record<SampleId, string> = { countries: 'World Countries', cities: 'World Cities', graticule: 'Graticule 10°', reference: 'Reference Lines' };

/** Create (or reuse) a sample dataset. */
export async function createSample(id: SampleId, reuse = false): Promise<Dataset> {
  if (reuse) {
    const existing = allDatasets().find((d) => d.name === NAME[id] && d.source === SOURCE[id]);
    if (existing) return existing;
  }
  const features =
    id === 'countries' ? await loadCountryFeatures()
    : id === 'cities' ? cityFeatures()
    : id === 'graticule' ? graticuleFeatures(10)
    : referenceLineFeatures();
  return createDataset({ name: NAME[id], features, source: SOURCE[id], geomType: id === 'countries' ? 'Polygon' : id === 'cities' ? 'Point' : 'LineString' });
}

// ---------- symbology ----------

const CONTINENT_COLORS: Record<string, string> = {
  Africa: '#e3b25b',
  Asia: '#d9908f',
  Europe: '#7fa6d6',
  'North America': '#8fc47f',
  'South America': '#b894cf',
  Oceania: '#6fc4ba',
  Antarctica: '#e6e9ee',
  'Seven seas (open ocean)': '#c8ccd2',
};

function continentRenderer(): FeatureLayer['renderer'] {
  const base = defaultSymbol('Polygon', '#cccccc');
  const classes: UniqueClass[] = CONTINENTS.map((c) => ({
    value: c,
    label: c,
    symbol: { ...base, fill: CONTINENT_COLORS[c] ?? '#cccccc', fillOpacity: 0.82, stroke: '#ffffff', strokeWidth: 0.7 },
  }));
  return { type: 'unique', field: 'CONTINENT', classes, defaultSymbol: { ...base, fillOpacity: 0.6 } };
}

const CITY_SYMBOL: SymbolDef = { fill: '#e8590c', fillOpacity: 0.92, stroke: '#ffffff', strokeWidth: 1.2, size: 5, shape: 'circle' };

/** Style a freshly added sample layer. */
export function styleSample(layerId: Id, id: SampleId) {
  if (id === 'countries') updateLayer<FeatureLayer>(layerId, { renderer: continentRenderer(), name: 'World Countries' });
  else if (id === 'cities')
    updateLayer<FeatureLayer>(layerId, {
      renderer: { type: 'proportional', field: 'POP_EST', minValue: 100000, maxValue: 37000000, minSize: 3, maxSize: 11, symbol: CITY_SYMBOL },
      labels: { enabled: true, expression: 'NAME', fontSize: 11, color: '#222222', haloColor: '#ffffff', haloWidth: 2, offsetY: -12, minZoom: 3.2 },
    });
  else if (id === 'graticule')
    updateLayer<FeatureLayer>(layerId, { renderer: { type: 'single', symbol: { fill: '#8a94a3', fillOpacity: 1, stroke: '#8a94a3', strokeWidth: 0.6, strokeOpacity: 0.7, strokeDash: [3, 3], size: 4, shape: 'circle' } } });
  else
    updateLayer<FeatureLayer>(layerId, { renderer: { type: 'single', symbol: { fill: '#c2410c', fillOpacity: 1, stroke: '#c2410c', strokeWidth: 1.2, size: 4, shape: 'circle' } }, labels: { enabled: true, expression: 'NAME', fontSize: 10, color: '#9a3412', haloColor: '#ffffff', haloWidth: 2, followLine: true, minZoom: 2 } });
}

/** Add sample datasets to the active map, styled. */
export async function addSamples(ids: SampleId[]): Promise<void> {
  const mapId = ensureActiveMap();
  let extent: [number, number, number, number] | null = null;
  // draw order: polygons below lines below points, handled by addDatasetLayer
  for (const id of ids) {
    const ds = await createSample(id);
    const layerId = addDatasetToMap(ds, mapId, NAME[id]);
    if (layerId) {
      styleSample(layerId, id);
      setActiveLayer(layerId);
    }
    const e = datasetExtent(ds.id);
    if (e && id !== 'graticule' && id !== 'reference') extent = extent ? [Math.min(extent[0], e[0]), Math.min(extent[1], e[1]), Math.max(extent[2], e[2]), Math.max(extent[3], e[3])] : e;
  }
  if (extent) void zoomToExtentWhenReady(mapId, extent);
}

/** The starter project: a world map with countries by continent and the major cities. */
export async function buildStarterProject(): Promise<void> {
  resetSession();
  newProject('Untitled');
  await createSampleMap();
  markSaved();
}

/** A new map holding the sample countries and cities (reusing datasets already in the project). */
export async function createSampleMap(): Promise<void> {
  const countries = await createSample('countries', true);
  const cities = await createSample('cities', true);
  const map = addMap({ name: 'World', basemap: 'light', view: { center: [10, 22], zoom: 1.6, rotation: 0 } });
  addLayer(map.id, makeFeatureLayer(countries, { name: 'World Countries', renderer: continentRenderer() }), 0);
  const pl = makeFeatureLayer(cities, { name: 'World Cities' });
  addLayer(map.id, pl, 0);
  styleSample(pl.id, 'cities');
  openView('map', map.id);
}
