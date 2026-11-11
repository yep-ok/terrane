// Coordinate parsing and formatting (pure). Accepts decimal degrees, degrees-minutes-seconds,
// hemisphere letters and single-line UTM; converts UTM <-> lon/lat with proj4.
import proj4 from 'proj4';

export type LatLonOrder = 'lat-lon' | 'lon-lat';
export type ParseResult = { ok: true; lon: number; lat: number } | { ok: false; error: string };

const fail = (error: string): ParseResult => ({ ok: false, error });

function normalise(text: string): string {
  return text
    .replace(/[′ʹ’‘`´]/g, "'")
    .replace(/[″ʺ”“]/g, '"')
    .replace(/[º˚]/g, '°')
    .replace(/\b(degrees?|deg)\b/gi, ' ')
    .trim();
}

interface Component {
  value: number;
  hemi: 'N' | 'S' | 'E' | 'W' | null;
}

function parseComponent(raw: string): Component | null {
  const hemis = raw.toUpperCase().match(/[NSEW]/g) ?? [];
  if (hemis.length > 1) return null;
  const nums = raw.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length > 3) return null;
  const [d, m, s] = nums.map(Number);
  if (m !== undefined && m >= 60) return null;
  if (s !== undefined && s >= 60) return null;
  let value = d + (m ?? 0) / 60 + (s ?? 0) / 3600;
  if (/^[^\d]*-/.test(raw.trim())) value = -value;
  const hemi = (hemis[0] as Component['hemi']) ?? null;
  if (hemi === 'S' || hemi === 'W') value = -Math.abs(value);
  return { value, hemi };
}

/** Split "a b" text into its two coordinate halves. */
function splitPair(text: string): [string, string] | null {
  const byCommaLike = text.split(/\s*[,;/|]\s*/).filter(Boolean);
  if (byCommaLike.length === 2) return [byCommaLike[0], byCommaLike[1]];
  const t = byCommaLike.length > 2 ? text.replace(/[,;/|]/g, ' ') : text;

  const letters = [...t.matchAll(/[NSEW]/gi)];
  if (letters.length === 2) {
    const firstDigit = t.search(/\d/);
    const i0 = letters[0].index!;
    const i1 = letters[1].index!;
    return i0 > firstDigit ? [t.slice(0, i0 + 1), t.slice(i0 + 1)] : [t.slice(0, i1), t.slice(i1)];
  }
  if (letters.length !== 0) return null;

  const toks = [...t.matchAll(/-?\d+(?:\.\d+)?/g)];
  const n = toks.length;
  if (n !== 2 && n !== 4 && n !== 6) return null;
  const cut = toks[n / 2 - 1];
  const at = cut.index! + cut[0].length;
  return [t.slice(0, at), t.slice(at)];
}

const UTM_LINE = /^(\d{1,2})\s*([C-HJ-NP-X])\s+(\d+(?:\.\d+)?)\s*m?\s*E?\s*[,;\s]\s*(\d+(?:\.\d+)?)\s*m?\s*N?$/i;

/**
 * Parse a coordinate typed by a person. `order` decides which number is the latitude when the text has no
 * hemisphere letters. Examples: "40.7128, -74.0060", `40°42'46"N 74°0'21.6"W`, "N 40 42 46 W 74 0 21", "18T 583960 4507523".
 */
export function parseCoordinate(input: string, order: LatLonOrder = 'lat-lon'): ParseResult {
  const text = normalise(input);
  if (!text) return fail('Enter a coordinate');

  const u = UTM_LINE.exec(text);
  if (u) {
    const zone = +u[1];
    const north = u[2].toUpperCase() >= 'N';
    return utmToLonLat(zone, north, +u[3], +u[4]);
  }

  const pair = splitPair(text);
  if (!pair) return fail('Could not read two coordinates (try "lat, lon")');
  const a = parseComponent(pair[0]);
  const b = parseComponent(pair[1]);
  if (!a || !b) return fail('Could not read the coordinate');

  const isLat = (h: Component['hemi']) => h === 'N' || h === 'S';
  const isLon = (h: Component['hemi']) => h === 'E' || h === 'W';
  let lat: number;
  let lon: number;
  if (a.hemi && b.hemi) {
    if (isLat(a.hemi) === isLat(b.hemi)) return fail('Use one N/S and one E/W hemisphere');
    [lat, lon] = isLat(a.hemi) ? [a.value, b.value] : [b.value, a.value];
  } else if (a.hemi || b.hemi) {
    const h = (a.hemi ?? b.hemi)!;
    const aIsLat = a.hemi ? isLat(a.hemi) : isLon(h);
    [lat, lon] = aIsLat ? [a.value, b.value] : [b.value, a.value];
  } else {
    [lat, lon] = order === 'lat-lon' ? [a.value, b.value] : [b.value, a.value];
  }
  if (Math.abs(lat) > 90) {
    const swapped = Math.abs(lon) <= 90 && Math.abs(lat) <= 180;
    return fail(`Latitude must be between -90 and 90${swapped ? ' (check the lat/lon order)' : ''}`);
  }
  if (Math.abs(lon) > 180) return fail('Longitude must be between -180 and 180');
  return { ok: true, lon, lat };
}

// ---------- UTM ----------

const utmDef = (zone: number, north: boolean) => `+proj=utm +zone=${zone}${north ? '' : ' +south'} +datum=WGS84 +units=m +no_defs`;

export function utmToLonLat(zone: number, north: boolean, easting: number, northing: number): ParseResult {
  if (!Number.isInteger(zone) || zone < 1 || zone > 60) return fail('UTM zone must be 1 to 60');
  if (!Number.isFinite(easting) || easting < 0 || easting > 1_000_000) return fail('Easting must be between 0 and 1,000,000');
  if (!Number.isFinite(northing) || northing < 0 || northing > 10_000_000) return fail('Northing must be between 0 and 10,000,000');
  try {
    const [lon, lat] = proj4(utmDef(zone, north)).inverse([easting, northing]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return fail('Not a valid UTM position');
    return { ok: true, lon, lat };
  } catch {
    return fail('Not a valid UTM position');
  }
}

const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
export interface Utm {
  zone: number;
  north: boolean;
  band: string;
  easting: number;
  northing: number;
}
export function lonLatToUtm(lon: number, lat: number): Utm {
  const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
  const north = lat >= 0;
  const [easting, northing] = proj4(utmDef(zone, north)).forward([lon, lat]);
  const band = BANDS[Math.min(BANDS.length - 1, Math.max(0, Math.floor((lat + 80) / 8)))];
  return { zone, north, band, easting, northing };
}
export const formatUtm = (u: Utm) => `${u.zone}${u.band} ${Math.round(u.easting)} ${Math.round(u.northing)}`;

// ---------- formatting ----------

/** "lat, lon" in decimal degrees. */
export const formatDD = (lon: number, lat: number, digits = 6) => `${lat.toFixed(digits)}, ${lon.toFixed(digits)}`;

function dms(value: number, pos: string, neg: string, secDigits: number): string {
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  let min = Math.floor((abs - deg) * 60);
  let sec = +(((abs - deg) * 60 - min) * 60).toFixed(secDigits);
  if (sec >= 60) {
    sec = 0;
    min += 1;
  }
  if (min >= 60) {
    min = 0;
    deg += 1;
  }
  return `${deg}°${String(min).padStart(2, '0')}'${sec.toFixed(secDigits).padStart(secDigits ? 3 + secDigits : 2, '0')}"${value < 0 ? neg : pos}`;
}
export const formatDMS = (lon: number, lat: number, secDigits = 2) => `${dms(lat, 'N', 'S', secDigits)} ${dms(lon, 'E', 'W', secDigits)}`;
