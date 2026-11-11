import type { TileSource } from './types';

export interface Basemap {
  id: string;
  name: string;
  source: TileSource;
  /** Representative swatch colours for the gallery tile (no network needed). */
  swatch: [string, string, string];
  dark?: boolean;
  /** Canvas 2D filter applied while drawing the tiles (e.g. greyscale variants of a source). */
  filter?: string;
}

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors';
const OSM: Basemap["source"] = { type: "xyz", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: OSM_ATTR, maxZoom: 19 };

export const BASEMAPS: Basemap[] = [
  { id: 'osm', name: 'OpenStreetMap', swatch: ['#aad3df', '#f2efe9', '#c8facc'], source: { type: 'xyz', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM_ATTR, maxZoom: 19 } },
  { id: 'light', name: 'Light Gray Canvas', swatch: ['#d4dadc', '#fafaf8', '#e9ece9'], source: OSM, filter: 'grayscale(1) contrast(0.85) brightness(1.04)' },
  { id: 'dark', name: 'Dark Gray Canvas', dark: true, swatch: ['#0e0e0e', '#262626', '#3a3a3a'], source: OSM, filter: 'grayscale(1) invert(1) contrast(0.8) brightness(0.85)' },
  { id: 'humanitarian', name: 'Humanitarian', swatch: ['#a5c8d8', '#f4efe6', '#e8c9a0'], source: { type: 'xyz', url: 'https://{a-c}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', attribution: OSM_ATTR + ', Humanitarian OpenStreetMap Team', maxZoom: 19 } },
  { id: 'terrain', name: 'Terrain (Light)', swatch: ['#b8d4e8', '#e9ead8', '#c9c2a8'], source: { type: 'xyz', url: 'https://tiles.maps.eox.at/wmts/1.0.0/terrain-light_3857/default/g/{z}/{y}/{x}.jpg', attribution: 'Terrain Light &copy; <a href="https://maps.eox.at" target="_blank">EOX</a>, data &copy; OpenStreetMap contributors and others', maxZoom: 12 } },
  { id: 'topo', name: 'Topographic', swatch: ['#97d2e3', '#e3ecc6', '#c9a77c'], source: { type: 'xyz', url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution: `${OSM_ATTR}, SRTM | &copy; <a href="https://opentopomap.org" target="_blank">OpenTopoMap</a> (CC-BY-SA)`, maxZoom: 17 } },
  { id: 'imagery', name: 'Imagery (Sentinel-2)', dark: true, swatch: ['#0b2a4a', '#3d5a2c', '#8a7a55'], source: { type: 'xyz', url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2016_3857/default/g/{z}/{y}/{x}.jpg', attribution: '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless</a> by EOX IT Services GmbH (Copernicus Sentinel data 2016)', maxZoom: 14 } },
];

export const getBasemap = (id: string | null | undefined) => BASEMAPS.find((b) => b.id === id);
