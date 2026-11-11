// Coordinate reference systems: proj4 definitions registered with OpenLayers.
import proj4 from 'proj4';
import { register } from 'ol/proj/proj4';
import { get as getProjection, transformExtent } from 'ol/proj';
import type { Extent } from './types';

export interface CrsInfo {
  code: string;
  name: string;
  /** Area of use in lon/lat; used to give the projection a valid extent. */
  bbox?: Extent;
  category: 'Geographic' | 'World' | 'Continental' | 'National' | 'UTM' | 'Polar' | 'Custom';
}

const WORLD: Extent = [-180, -90, 180, 90];
const DEFS: Array<CrsInfo & { def?: string }> = [
  { code: 'EPSG:3857', name: 'WGS 1984 Web Mercator (Auxiliary Sphere)', category: 'World' },
  { code: 'EPSG:4326', name: 'WGS 1984 (Geographic)', category: 'Geographic' },
  { code: 'ESRI:54030', name: 'World Robinson', category: 'World', bbox: WORLD, def: '+proj=robin +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs' },
  { code: 'ESRI:54009', name: 'World Mollweide', category: 'World', bbox: WORLD, def: '+proj=moll +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs' },
  { code: 'EPSG:8857', name: 'Equal Earth (Greenwich)', category: 'World', bbox: WORLD, def: '+proj=eqearth +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs' },
  { code: 'ESRI:54008', name: 'World Sinusoidal', category: 'World', bbox: WORLD, def: '+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs' },
  { code: 'EPSG:5070', name: 'NAD 1983 CONUS Albers', category: 'Continental', bbox: [-125, 24, -66, 50], def: '+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs' },
  { code: 'EPSG:3035', name: 'ETRS 1989 LAEA Europe', category: 'Continental', bbox: [-25, 30, 45, 72], def: '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' },
  { code: 'EPSG:27700', name: 'British National Grid', category: 'National', bbox: [-9, 49.75, 2.1, 61.1], def: '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs' },
  { code: 'EPSG:2154', name: 'RGF93 Lambert-93 (France)', category: 'National', bbox: [-9.9, 41.1, 10.4, 51.6], def: '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' },
  { code: 'EPSG:3577', name: 'GDA94 Australian Albers', category: 'National', bbox: [112, -45, 155, -9], def: '+proj=aea +lat_0=0 +lon_0=132 +lat_1=-18 +lat_2=-36 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' },
  { code: 'EPSG:3413', name: 'NSIDC Sea Ice Polar Stereographic North', category: 'Polar', bbox: [-180, 55, 180, 90], def: '+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs' },
  { code: 'EPSG:3031', name: 'Antarctic Polar Stereographic', category: 'Polar', bbox: [-180, -90, 180, -55], def: '+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs' },
];

/** Known coordinate systems (grows as UTM zones / custom codes are registered). */
export const CRS_LIST: CrsInfo[] = [];

function install(info: CrsInfo, def?: string) {
  if (def) {
    proj4.defs(info.code, def);
    register(proj4);
    const p = getProjection(info.code);
    if (p && info.bbox) {
      try {
        p.setWorldExtent(info.bbox);
        const e = transformExtent(info.bbox, 'EPSG:4326', info.code, 16);
        if (e.every(Number.isFinite)) p.setExtent(e);
      } catch {}
    }
  }
  if (!CRS_LIST.some((c) => c.code === info.code)) CRS_LIST.push({ code: info.code, name: info.name, bbox: info.bbox, category: info.category });
}
for (const d of DEFS) install(d, d.def);

export const isCrsRegistered = (code: string) => !!getProjection(code);
export const crsInfo = (code: string) => CRS_LIST.find((c) => c.code === code);
export const crsName = (code: string) => crsInfo(code)?.name ?? code;

/** EPSG code of the WGS84 UTM zone containing a lon/lat. */
export function utmCodeFor(lon: number, lat: number): string {
  const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
  return `EPSG:${(lat >= 0 ? 32600 : 32700) + zone}`;
}

function tryUtm(code: string): boolean {
  const m = /^EPSG:(326|327)(\d{2})$/.exec(code);
  if (!m) return false;
  const zone = +m[2];
  if (zone < 1 || zone > 60) return false;
  const south = m[1] === '327';
  const lon0 = zone * 6 - 183;
  install(
    { code, name: `WGS 1984 UTM Zone ${zone}${south ? 'S' : 'N'}`, category: 'UTM', bbox: [lon0 - 9, south ? -80 : 0, lon0 + 9, south ? 0 : 84] },
    `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`,
  );
  return true;
}

/** Register a CRS from a proj4 string. */
export function registerCrs(code: string, name: string, def: string, bbox?: Extent) {
  install({ code, name, bbox, category: 'Custom' }, def);
}

/**
 * Make sure a CRS is usable. Built-ins and UTM zones resolve immediately;
 * other EPSG codes are looked up on epsg.io. Resolves false if unavailable.
 */
export async function ensureCrs(code: string): Promise<boolean> {
  if (isCrsRegistered(code)) return true;
  if (tryUtm(code)) return true;
  const m = /^EPSG:(\d+)$/.exec(code);
  if (!m) return false;
  try {
    const res = await fetch(`https://epsg.io/${m[1]}.proj4`);
    if (!res.ok) return false;
    const def = (await res.text()).trim();
    if (!def.startsWith('+')) return false;
    registerCrs(code, code, def);
    return isCrsRegistered(code);
  } catch {
    return false;
  }
}
/** Synchronous variant for built-ins and UTM zones. */
export function ensureCrsSync(code: string): boolean {
  return isCrsRegistered(code) || tryUtm(code);
}

export { proj4 };
