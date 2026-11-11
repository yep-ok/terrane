// Minimal GeoTIFF header reader: image size, georeferencing tags and EPSG code.
// Enough to zoom to a raster on import; pixel decoding is done by the raster renderer.
import proj4 from 'proj4';
import { ensureCrs } from '../../../core/crs';

export interface TiffGeoInfo {
  width: number;
  height: number;
  /** minX, minY, maxX, maxY in the raster's own CRS. */
  bbox: [number, number, number, number] | null;
  epsg: number | null;
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

async function read(blob: Blob, offset: number, length: number): Promise<DataView> {
  return new DataView(await blob.slice(offset, offset + length).arrayBuffer());
}

export async function readTiffGeoInfo(blob: Blob): Promise<TiffGeoInfo | null> {
  const head = await read(blob, 0, 8);
  if (head.byteLength < 8) return null;
  const order = head.getUint16(0);
  const le = order === 0x4949;
  if (!le && order !== 0x4d4d) return null;
  if (head.getUint16(2, le) !== 42) return null; // classic TIFF only
  const ifdOffset = head.getUint32(4, le);
  const countView = await read(blob, ifdOffset, 2);
  const n = countView.getUint16(0, le);
  const dir = await read(blob, ifdOffset + 2, n * 12);

  const tags = new Map<number, { type: number; count: number; valueOffset: number; inline: DataView }>();
  for (let i = 0; i < n; i++) {
    const o = i * 12;
    tags.set(dir.getUint16(o, le), {
      type: dir.getUint16(o + 2, le),
      count: dir.getUint32(o + 4, le),
      valueOffset: dir.getUint32(o + 8, le),
      inline: new DataView(dir.buffer, dir.byteOffset + o + 8, 4),
    });
  }

  const numbers = async (tag: number): Promise<number[] | null> => {
    const t = tags.get(tag);
    if (!t) return null;
    const size = TYPE_SIZE[t.type] ?? 1;
    const total = size * t.count;
    const view = total <= 4 ? t.inline : await read(blob, t.valueOffset, total);
    const out: number[] = [];
    for (let i = 0; i < t.count; i++) {
      const o = i * size;
      if (t.type === 3) out.push(view.getUint16(o, le));
      else if (t.type === 4) out.push(view.getUint32(o, le));
      else if (t.type === 12) out.push(view.getFloat64(o, le));
      else if (t.type === 1) out.push(view.getUint8(o));
      else return null;
    }
    return out;
  };

  const width = (await numbers(256))?.[0];
  const height = (await numbers(257))?.[0];
  if (!width || !height) return null;

  let bbox: TiffGeoInfo['bbox'] = null;
  const scale = await numbers(33550);
  const tie = await numbers(33922);
  const matrix = await numbers(34264);
  if (matrix && matrix.length >= 16) {
    const f = (i: number, j: number): [number, number] => [matrix[0] * i + matrix[1] * j + matrix[3], matrix[4] * i + matrix[5] * j + matrix[7]];
    const pts = [f(0, 0), f(width, 0), f(0, height), f(width, height)];
    bbox = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  } else if (scale && tie && scale.length >= 2 && tie.length >= 6) {
    const x0 = tie[3] - tie[0] * scale[0];
    const y0 = tie[4] + tie[1] * scale[1];
    bbox = [x0, y0 - height * scale[1], x0 + width * scale[0], y0];
  }

  let epsg: number | null = null;
  const keys = await numbers(34735);
  if (keys && keys.length >= 4) {
    for (let i = 0; i < keys[3]; i++) {
      const [id, loc, , value] = keys.slice(4 + i * 4, 8 + i * 4);
      if (loc === 0 && (id === 3072 || id === 2048) && value !== 32767) {
        epsg = value;
        if (id === 3072) break;
      }
    }
  }
  return { width, height, bbox, epsg };
}

/** Raster extent as lon/lat, or null when georeferencing is missing or the CRS is unknown. */
export async function tiffLonLatExtent(blob: Blob): Promise<[number, number, number, number] | null> {
  const info = await readTiffGeoInfo(blob);
  if (!info?.bbox) return null;
  const code = info.epsg ? `EPSG:${info.epsg}` : 'EPSG:4326';
  if (code === 'EPSG:4326') return clampExtent(info.bbox);
  if (!(await ensureCrs(code))) return null;
  const t = proj4(code, 'EPSG:4326');
  const [x0, y0, x1, y1] = info.bbox;
  const pts = [t.forward([x0, y0]), t.forward([x1, y0]), t.forward([x0, y1]), t.forward([x1, y1])];
  return clampExtent([Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]);
}

function clampExtent(e: [number, number, number, number]): [number, number, number, number] | null {
  if (!e.every(Number.isFinite)) return null;
  return [Math.max(-180, e[0]), Math.max(-90, e[1]), Math.min(180, e[2]), Math.min(90, e[3])];
}
