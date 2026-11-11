// Place search against the public Nominatim API (https://nominatim.org/release-docs/latest/api/Search/).
// Usage policy: at most one request per second, identify via the browser Referer, show attribution.
import type { Extent } from '../../core/types';

export interface PlaceResult {
  id: string;
  name: string;
  detail: string;
  type: string;
  lon: number;
  lat: number;
  /** minLon, minLat, maxLon, maxLat, or null when the place is a point. */
  extent: Extent | null;
}

export function parseNominatim(json: unknown): PlaceResult[] {
  if (!Array.isArray(json)) return [];
  const out: PlaceResult[] = [];
  for (const it of json as any[]) {
    const lat = Number(it?.lat);
    const lon = Number(it?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const display = String(it.display_name ?? '');
    const comma = display.indexOf(',');
    const name = String(it.name || (comma > 0 ? display.slice(0, comma) : display) || 'Unnamed place');
    const detail = comma > 0 && !it.name ? display.slice(comma + 1).trim() : display;
    let extent: Extent | null = null;
    if (Array.isArray(it.boundingbox) && it.boundingbox.length === 4) {
      const [s, n, w, e] = it.boundingbox.map(Number);
      if ([s, n, w, e].every(Number.isFinite) && (n - s > 1e-5 || e - w > 1e-5)) extent = [w, s, e, n];
    }
    out.push({
      id: String(it.place_id ?? `${lon},${lat}`),
      name,
      detail,
      type: String(it.addresstype ?? it.type ?? it.category ?? '').replace(/_/g, ' '),
      lon,
      lat,
      extent,
    });
  }
  return out;
}

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const MIN_GAP_MS = 1000;
let nextSlot = 0;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

/** Search for places. Calls are spaced at least one second apart across the whole app. */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const slot = Math.max(Date.now(), nextSlot);
  nextSlot = slot + MIN_GAP_MS;
  await sleep(slot - Date.now(), signal);
  const url = `${NOMINATIM_URL}?format=jsonv2&limit=8&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(res.status === 429 ? 'The search service is busy, try again in a moment' : `Search failed (HTTP ${res.status})`);
  return parseNominatim(await res.json());
}
