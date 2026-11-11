import type { TileSource } from './types';

export interface Basemap {
  id: string;
  name: string;
  source: TileSource;
  /** Representative swatch colours for the gallery tile (no network needed). */
  swatch: [string, string, string];
  dark?: boolean;
}

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors';
const CARTO_ATTR = `${OSM_ATTR} &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>`;

export const BASEMAPS: Basemap[] = [
  { id: 'osm', name: 'OpenStreetMap', swatch: ['#aad3df', '#f2efe9', '#c8facc'], source: { type: 'xyz', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM_ATTR, maxZoom: 19 } },
  { id: 'light', name: 'Light Gray Canvas', swatch: ['#d4dadc', '#fafaf8', '#e9ece9'], source: { type: 'xyz', url: 'https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', attribution: CARTO_ATTR, maxZoom: 20 } },
  { id: 'dark', name: 'Dark Gray Canvas', dark: true, swatch: ['#0e0e0e', '#262626', '#3a3a3a'], source: { type: 'xyz', url: 'https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', attribution: CARTO_ATTR, maxZoom: 20 } },
  { id: 'voyager', name: 'Streets (Voyager)', swatch: ['#c5e0ee', '#fbf8f3', '#f5d9a8'], source: { type: 'xyz', url: 'https://{a-d}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', attribution: CARTO_ATTR, maxZoom: 20 } },
  { id: 'light-nolabels', name: 'Light Gray (No Labels)', swatch: ['#d4dadc', '#fafaf8', '#f0f0ee'], source: { type: 'xyz', url: 'https://{a-d}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png', attribution: CARTO_ATTR, maxZoom: 20 } },
  { id: 'topo', name: 'Topographic', swatch: ['#97d2e3', '#e3ecc6', '#c9a77c'], source: { type: 'xyz', url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution: `${OSM_ATTR}, SRTM | &copy; <a href="https://opentopomap.org" target="_blank">OpenTopoMap</a> (CC-BY-SA)`, maxZoom: 17 } },
  { id: 'imagery', name: 'Imagery (Sentinel-2)', dark: true, swatch: ['#0b2a4a', '#3d5a2c', '#8a7a55'], source: { type: 'xyz', url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2016_3857/default/g/{z}/{y}/{x}.jpg', attribution: '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless</a> by EOX IT Services GmbH (Copernicus Sentinel data 2016)', maxZoom: 14 } },
];

export const getBasemap = (id: string | null | undefined) => BASEMAPS.find((b) => b.id === id);
