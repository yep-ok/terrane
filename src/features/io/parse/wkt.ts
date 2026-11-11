// WKT <-> GeoJSON geometry (2D; Z/M ordinates are dropped).
import type { Geometry, Position } from 'geojson';

class Reader {
  i = 0;
  constructor(public s: string) {}
  ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  peek() {
    this.ws();
    return this.s[this.i];
  }
  eat(ch: string) {
    this.ws();
    if (this.s[this.i] !== ch) throw new Error(`WKT: expected "${ch}" at ${this.i}`);
    this.i++;
  }
  tryEat(ch: string) {
    this.ws();
    if (this.s[this.i] === ch) {
      this.i++;
      return true;
    }
    return false;
  }
  word(): string {
    this.ws();
    const m = /^[A-Za-z]+/.exec(this.s.slice(this.i));
    if (!m) return '';
    this.i += m[0].length;
    return m[0].toUpperCase();
  }
  num(): number {
    this.ws();
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(this.s.slice(this.i));
    if (!m) throw new Error(`WKT: number expected at ${this.i}`);
    this.i += m[0].length;
    return parseFloat(m[0]);
  }
}

function position(r: Reader): Position {
  const x = r.num();
  const y = r.num();
  // swallow Z / M
  while (/[-+\d.]/.test(r.peek() ?? '')) r.num();
  return [x, y];
}

function list<T>(r: Reader, item: () => T): T[] {
  r.eat('(');
  const out: T[] = [item()];
  while (r.tryEat(',')) out.push(item());
  r.eat(')');
  return out;
}

function isEmpty(r: Reader): boolean {
  const save = r.i;
  if (r.word() === 'EMPTY') return true;
  r.i = save;
  return false;
}

function geometry(r: Reader): Geometry | null {
  let type = r.word();
  if (!type) throw new Error('WKT: geometry type expected');
  // dimension tags
  const save = r.i;
  const dim = r.word();
  if (dim !== 'Z' && dim !== 'M' && dim !== 'ZM') r.i = save;
  if (isEmpty(r)) return null;
  switch (type) {
    case 'POINT': {
      r.eat('(');
      const p = position(r);
      r.eat(')');
      return { type: 'Point', coordinates: p };
    }
    case 'LINESTRING':
      return { type: 'LineString', coordinates: list(r, () => position(r)) };
    case 'POLYGON':
      return { type: 'Polygon', coordinates: list(r, () => list(r, () => position(r))) };
    case 'MULTIPOINT':
      return {
        type: 'MultiPoint',
        coordinates: list(r, () => {
          if (r.peek() === '(') {
            r.eat('(');
            const p = position(r);
            r.eat(')');
            return p;
          }
          return position(r);
        }),
      };
    case 'MULTILINESTRING':
      return { type: 'MultiLineString', coordinates: list(r, () => list(r, () => position(r))) };
    case 'MULTIPOLYGON':
      return { type: 'MultiPolygon', coordinates: list(r, () => list(r, () => list(r, () => position(r)))) };
    case 'GEOMETRYCOLLECTION': {
      const geoms = list(r, () => geometry(r)).filter((g): g is Geometry => !!g);
      return { type: 'GeometryCollection', geometries: geoms };
    }
    default:
      throw new Error(`WKT: unsupported geometry type ${type}`);
  }
}

/** Parse WKT / EWKT text. Returns null for empty geometries; throws on malformed input. */
export function parseWkt(text: string): Geometry | null {
  let s = text.trim();
  s = s.replace(/^SRID=\d+;/i, '');
  const r = new Reader(s);
  return geometry(r);
}

export function tryParseWkt(text: unknown): Geometry | null {
  if (typeof text !== 'string' || !/^\s*(SRID=\d+;)?\s*[A-Za-z]+\s*[ZM]*\s*[(E]/i.test(text)) return null;
  try {
    return parseWkt(text);
  } catch {
    return null;
  }
}

const pos = (p: Position) => `${p[0]} ${p[1]}`;
const ring = (c: Position[]) => `(${c.map(pos).join(', ')})`;

export function toWkt(g: Geometry | null | undefined): string {
  if (!g) return '';
  switch (g.type) {
    case 'Point':
      return `POINT (${pos(g.coordinates)})`;
    case 'LineString':
      return `LINESTRING ${ring(g.coordinates)}`;
    case 'Polygon':
      return `POLYGON (${g.coordinates.map(ring).join(', ')})`;
    case 'MultiPoint':
      return `MULTIPOINT (${g.coordinates.map((p) => `(${pos(p)})`).join(', ')})`;
    case 'MultiLineString':
      return `MULTILINESTRING (${g.coordinates.map(ring).join(', ')})`;
    case 'MultiPolygon':
      return `MULTIPOLYGON (${g.coordinates.map((poly) => `(${poly.map(ring).join(', ')})`).join(', ')})`;
    case 'GeometryCollection':
      return `GEOMETRYCOLLECTION (${g.geometries.map(toWkt).join(', ')})`;
  }
}
