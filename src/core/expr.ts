// Terrane expression language: tokenizer + Pratt parser + closure compiler.
// No eval / new Function. One language serves where-clauses (definition queries,
// Select By Attributes), label expressions and the field calculator:
//   POP > 1000000 AND NAME LIKE 'A%'
//   NAME + " (" + Round(POP / 1e6, 1) + "M)"
// Fields: bare identifier, [Field With Spaces], or $feature.NAME / $feature["x"].
// Strings: '..' or ".." (a doubled quote escapes itself).
// Null semantics are deliberately simple: comparisons involving null are false,
// arithmetic with null yields null, and evaluation never throws (errors yield null).
import type { Geometry, Position } from 'geojson';
import { area as turfArea, centroid as turfCentroid, length as turfLength, lineString as turfLine } from '@turf/turf';

export interface ExprFeature {
  id?: number | string;
  properties: Record<string, any> | null;
  geometry?: Geometry | null;
}
export type Compiled = (feature: ExprFeature) => any;

export class ExprError extends Error {
  constructor(message: string, public position?: number) {
    super(message);
    this.name = 'ExprError';
  }
}

export interface ExprFunctionDoc {
  name: string;
  signature: string;
  description: string;
  category: string;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokKind = 'num' | 'str' | 'id' | 'field' | 'op' | 'eof';
interface Token {
  k: TokKind;
  v: any;
  pos: number;
}

const TWO_CHAR = new Set(['<=', '>=', '<>', '!=', '==', '&&', '||']);
const ONE_CHAR = new Set(['+', '-', '*', '/', '%', '(', ')', ',', '=', '<', '>', '!', '.', ']']);
const ID_START = /[\p{L}_$]/u;
const ID_PART = /[\p{L}\p{N}_$]/u;

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    const start = i;
    const next = src[i + 1];
    if ((c >= '0' && c <= '9') || (c === '.' && next !== undefined && next >= '0' && next <= '9')) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      i += m[0].length;
      out.push({ k: 'num', v: Number(m[0]), pos: start });
      continue;
    }
    if (c === "'" || c === '"') {
      let s = '';
      i++;
      let closed = false;
      while (i < n) {
        if (src[i] === c) {
          if (src[i + 1] === c) {
            s += c;
            i += 2;
            continue;
          }
          closed = true;
          i++;
          break;
        }
        s += src[i++];
      }
      if (!closed) throw new ExprError('Unterminated string', start);
      out.push({ k: 'str', v: s, pos: start });
      continue;
    }
    if (c === '[') {
      const prev = out[out.length - 1];
      if (prev && prev.k === 'id' && String(prev.v).toLowerCase() === '$feature') {
        out.push({ k: 'op', v: '[', pos: start });
        i++;
        continue;
      }
      let s = '';
      i++;
      let closed = false;
      while (i < n) {
        if (src[i] === ']') {
          if (src[i + 1] === ']') {
            s += ']';
            i += 2;
            continue;
          }
          closed = true;
          i++;
          break;
        }
        s += src[i++];
      }
      if (!closed) throw new ExprError("Missing closing ']' in field name", start);
      if (!s.trim()) throw new ExprError('Empty field name', start);
      out.push({ k: 'field', v: s, pos: start });
      continue;
    }
    if (ID_START.test(c)) {
      i++;
      while (i < n && ID_PART.test(src[i])) i++;
      out.push({ k: 'id', v: src.slice(start, i), pos: start });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR.has(two)) {
      out.push({ k: 'op', v: two, pos: start });
      i += 2;
      continue;
    }
    if (ONE_CHAR.has(c)) {
      out.push({ k: 'op', v: c, pos: start });
      i++;
      continue;
    }
    throw new ExprError(`Unexpected character '${c}'`, start);
  }
  out.push({ k: 'eof', v: null, pos: n });
  return out;
}

// ---------------------------------------------------------------------------
// Parser (Pratt)
// ---------------------------------------------------------------------------

type Ast =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'field'; name: string }
  | { t: 'dyn'; expr: Ast }
  | { t: 'neg'; a: Ast }
  | { t: 'not'; a: Ast }
  | { t: 'bin'; op: string; a: Ast; b: Ast }
  | { t: 'cmp'; op: string; a: Ast; b: Ast }
  | { t: 'logic'; op: 'and' | 'or'; a: Ast; b: Ast }
  | { t: 'like'; a: Ast; p: Ast; neg: boolean }
  | { t: 'in'; a: Ast; list: Ast[]; neg: boolean }
  | { t: 'isnull'; a: Ast; neg: boolean }
  | { t: 'between'; a: Ast; lo: Ast; hi: Ast; neg: boolean }
  | { t: 'call'; name: string; args: Ast[]; pos: number };

const BP_OR = 10;
const BP_AND = 20;
const BP_NOT = 30;
const BP_CMP = 40;
const BP_ADD = 50;
const BP_MUL = 60;
const BP_UNARY = 70;

const CMP_OPS = new Set(['=', '==', '!=', '<>', '<', '<=', '>', '>=']);

class Parser {
  private p = 0;
  constructor(private toks: Token[]) {}

  parse(): Ast {
    const ast = this.expr(0);
    const t = this.peek();
    if (t.k !== 'eof') throw new ExprError(`Unexpected ${this.describe(t)}`, t.pos);
    return ast;
  }

  private peek(o = 0) {
    return this.toks[Math.min(this.p + o, this.toks.length - 1)];
  }
  private next() {
    return this.toks[this.p++];
  }
  private describe(t: Token) {
    return t.k === 'eof' ? 'end of expression' : t.k === 'str' ? `string '${t.v}'` : `'${t.k === 'field' ? `[${t.v}]` : t.v}'`;
  }
  private kw(t: Token, word: string) {
    return t.k === 'id' && String(t.v).toUpperCase() === word;
  }
  private isOp(t: Token, op: string) {
    return t.k === 'op' && t.v === op;
  }
  private expectOp(op: string) {
    const t = this.next();
    if (!this.isOp(t, op)) throw new ExprError(`Expected '${op}' but found ${this.describe(t)}`, t.pos);
  }

  /** Binding power of the token as an infix/postfix operator (0 = not an operator). */
  private infixBp(t: Token): number {
    if (t.k === 'op') {
      if (t.v === '||') return BP_OR;
      if (t.v === '&&') return BP_AND;
      if (CMP_OPS.has(t.v)) return BP_CMP;
      if (t.v === '+' || t.v === '-') return BP_ADD;
      if (t.v === '*' || t.v === '/' || t.v === '%') return BP_MUL;
      return 0;
    }
    if (t.k === 'id') {
      const w = String(t.v).toUpperCase();
      if (w === 'OR') return BP_OR;
      if (w === 'AND') return BP_AND;
      if (w === 'LIKE' || w === 'IN' || w === 'IS' || w === 'BETWEEN') return BP_CMP;
      if (w === 'NOT') {
        const n = this.peek(1);
        if (this.kw(n, 'LIKE') || this.kw(n, 'IN') || this.kw(n, 'BETWEEN')) return BP_CMP;
      }
    }
    return 0;
  }

  private expr(minBp: number): Ast {
    let left = this.nud();
    for (;;) {
      const t = this.peek();
      const bp = this.infixBp(t);
      if (bp <= minBp) break;
      left = this.led(left, bp);
    }
    return left;
  }

  private nud(): Ast {
    const t = this.next();
    switch (t.k) {
      case 'num':
        return { t: 'num', v: t.v };
      case 'str':
        return { t: 'str', v: t.v };
      case 'field':
        return { t: 'field', name: t.v };
      case 'eof':
        throw new ExprError('Unexpected end of expression', t.pos);
      case 'op': {
        if (t.v === '(') {
          const e = this.expr(0);
          this.expectOp(')');
          return e;
        }
        if (t.v === '-') return { t: 'neg', a: this.expr(BP_UNARY) };
        if (t.v === '+') return this.expr(BP_UNARY);
        if (t.v === '!') return { t: 'not', a: this.expr(BP_NOT) };
        throw new ExprError(`Unexpected ${this.describe(t)}`, t.pos);
      }
      case 'id': {
        const name: string = t.v;
        const up = name.toUpperCase();
        if (up !== 'NOT' && this.isOp(this.peek(), '(')) {
          this.next();
          const args: Ast[] = [];
          if (!this.isOp(this.peek(), ')')) {
            for (;;) {
              args.push(this.expr(0));
              if (this.isOp(this.peek(), ',')) {
                this.next();
                continue;
              }
              break;
            }
          }
          this.expectOp(')');
          return { t: 'call', name, args, pos: t.pos };
        }
        if (up === 'NOT') return { t: 'not', a: this.expr(BP_NOT) };
        if (up === 'TRUE') return { t: 'bool', v: true };
        if (up === 'FALSE') return { t: 'bool', v: false };
        if (up === 'NULL') return { t: 'null' };
        if (up === '$FEATURE') {
          const n = this.next();
          if (this.isOp(n, '.')) {
            const f = this.next();
            if (f.k !== 'id' && f.k !== 'field') throw new ExprError("Expected a field name after '$feature.'", f.pos);
            return { t: 'field', name: String(f.v) };
          }
          if (this.isOp(n, '[')) {
            const e = this.expr(0);
            this.expectOp(']');
            return e.t === 'str' ? { t: 'field', name: e.v } : { t: 'dyn', expr: e };
          }
          throw new ExprError("Expected '.FIELD' or '[\"field\"]' after $feature", n.pos);
        }
        if (['AND', 'OR', 'LIKE', 'IN', 'IS', 'BETWEEN'].includes(up))
          throw new ExprError(`Unexpected keyword ${up}`, t.pos);
        return { t: 'field', name };
      }
    }
  }

  private led(left: Ast, bp: number): Ast {
    const t = this.next();
    if (t.k === 'op') {
      const op: string = t.v;
      if (op === '||') return { t: 'logic', op: 'or', a: left, b: this.expr(bp) };
      if (op === '&&') return { t: 'logic', op: 'and', a: left, b: this.expr(bp) };
      if (CMP_OPS.has(op)) return { t: 'cmp', op, a: left, b: this.expr(bp) };
      return { t: 'bin', op, a: left, b: this.expr(bp) };
    }
    const w = String(t.v).toUpperCase();
    if (w === 'OR') return { t: 'logic', op: 'or', a: left, b: this.expr(bp) };
    if (w === 'AND') return { t: 'logic', op: 'and', a: left, b: this.expr(bp) };
    let neg = false;
    let word = w;
    if (w === 'NOT') {
      neg = true;
      word = String(this.next().v).toUpperCase();
    }
    if (word === 'LIKE') return { t: 'like', a: left, p: this.expr(bp), neg };
    if (word === 'IN') {
      this.expectOp('(');
      const list: Ast[] = [];
      if (!this.isOp(this.peek(), ')')) {
        for (;;) {
          list.push(this.expr(0));
          if (this.isOp(this.peek(), ',')) {
            this.next();
            continue;
          }
          break;
        }
      }
      this.expectOp(')');
      return { t: 'in', a: left, list, neg };
    }
    if (word === 'BETWEEN') {
      const lo = this.expr(bp);
      const and = this.next();
      if (!this.kw(and, 'AND')) throw new ExprError("Expected AND in BETWEEN ... AND ...", and.pos);
      const hi = this.expr(bp);
      return { t: 'between', a: left, lo, hi, neg };
    }
    // IS [NOT] NULL
    let isNeg = false;
    if (this.kw(this.peek(), 'NOT')) {
      this.next();
      isNeg = true;
    }
    const nul = this.next();
    if (!this.kw(nul, 'NULL')) throw new ExprError('Expected NULL after IS', nul.pos);
    return { t: 'isnull', a: left, neg: isNeg };
  }
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

type Node = (f: ExprFeature) => any;

function num(v: any): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function str(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function truthy(v: any): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s !== '' && s !== 'false' && s !== '0';
  }
  return true;
}

/** Three-way comparison; null when either side is null or the values are incomparable. */
function compare(a: any, b: any): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  if (a instanceof Date) a = a.toISOString();
  if (b instanceof Date) b = b.toISOString();
  const ta = typeof a;
  const tb = typeof b;
  if (ta === 'number' && tb === 'number') return Number.isNaN(a) || Number.isNaN(b) ? null : a < b ? -1 : a > b ? 1 : 0;
  if (ta === 'string' && tb === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (ta === 'boolean' || tb === 'boolean') {
    const x = ta === 'boolean' ? (a ? 1 : 0) : truthy(a) ? 1 : 0;
    const y = tb === 'boolean' ? (b ? 1 : 0) : truthy(b) ? 1 : 0;
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const x = num(a);
  const y = num(b);
  if (x !== null && y !== null) return x < y ? -1 : x > y ? 1 : 0;
  const sa = str(a);
  const sb = str(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function getField(f: ExprFeature, name: string): any {
  const p = f.properties;
  if (!p) return null;
  const v = p[name];
  if (v !== undefined) return v;
  if (name in p) return null;
  const ln = name.toLowerCase();
  for (const k in p) if (k.toLowerCase() === ln) return p[k] ?? null;
  return null;
}

const likeCache = new Map<string, RegExp>();
function likeRegex(pattern: string): RegExp {
  let re = likeCache.get(pattern);
  if (!re) {
    let s = '';
    for (const ch of pattern) {
      if (ch === '%') s += '[\\s\\S]*';
      else if (ch === '_') s += '[\\s\\S]';
      else s += ch.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
    }
    re = new RegExp(`^${s}$`, 'i');
    if (likeCache.size > 500) likeCache.clear();
    likeCache.set(pattern, re);
  }
  return re;
}

function round(x: number, d = 0): number {
  d = Math.max(0, Math.min(15, Math.trunc(d)));
  const a = Math.abs(x);
  const s = x < 0 ? -1 : 1;
  const txt = String(a);
  if (txt.includes('e')) {
    const m = 10 ** d;
    return (s * Math.round(a * m)) / m;
  }
  return s * Number(Math.round(Number(`${a}e${d}`)) + `e-${d}`);
}

// ---------------------------------------------------------------------------
// Geometry helpers (geodesic, via turf)
// ---------------------------------------------------------------------------

const AREA_UNITS: Record<string, number> = {
  sqm: 1, m2: 1, sqkm: 1e-6, km2: 1e-6, ha: 1e-4, hectares: 1e-4, acres: 1 / 4046.8564224, ac: 1 / 4046.8564224,
  sqmi: 1 / 2589988.110336, mi2: 1 / 2589988.110336, sqft: 1 / 0.09290304, ft2: 1 / 0.09290304,
};
const LENGTH_UNITS: Record<string, number> = { m: 1, meters: 1, km: 1e-3, kilometers: 1e-3, mi: 1 / 1609.344, miles: 1 / 1609.344, ft: 1 / 0.3048, feet: 1 / 0.3048, yd: 1 / 0.9144 };

function geomArea(g: Geometry | null | undefined): number | null {
  if (!g) return null;
  if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') return null;
  return turfArea({ type: 'Feature', properties: {}, geometry: g });
}

function ringLength(coords: Position[]): number {
  return coords.length < 2 ? 0 : turfLength(turfLine(coords), { units: 'kilometers' }) * 1000;
}

function geomLength(g: Geometry | null | undefined): number | null {
  if (!g) return null;
  switch (g.type) {
    case 'LineString':
      return ringLength(g.coordinates);
    case 'MultiLineString':
    case 'Polygon':
      return g.coordinates.reduce((s, r) => s + ringLength(r), 0);
    case 'MultiPolygon':
      return g.coordinates.reduce((s, poly) => s + poly.reduce((s2, r) => s2 + ringLength(r), 0), 0);
    case 'Point':
    case 'MultiPoint':
      return 0;
    default:
      return null;
  }
}

const centroidCache = new WeakMap<object, [number, number] | null>();
function geomCentroid(g: Geometry | null | undefined): [number, number] | null {
  if (!g) return null;
  const hit = centroidCache.get(g);
  if (hit !== undefined) return hit;
  let c: [number, number] | null = null;
  try {
    if (g.type === 'Point') c = [g.coordinates[0], g.coordinates[1]];
    else {
      const p = turfCentroid({ type: 'Feature', properties: {}, geometry: g }).geometry.coordinates;
      c = [p[0], p[1]];
    }
  } catch {
    c = null;
  }
  centroidCache.set(g, c);
  return c;
}

function countPoints(g: Geometry | null | undefined): number {
  if (!g) return 0;
  if (g.type === 'GeometryCollection') return g.geometries.reduce((s, x) => s + countPoints(x), 0);
  let n = 0;
  const walk = (c: any) => {
    if (typeof c[0] === 'number') n++;
    else for (const x of c) walk(x);
  };
  walk(g.coordinates);
  return n;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

interface DateParts {
  y: number;
  m: number;
  d: number;
  ms: number;
}
const ISO_PREFIX = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/;

function dateParts(v: any): DateParts | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') {
    const m = ISO_PREFIX.exec(v.trim());
    const ms = Date.parse(v.trim());
    if (m) {
      return { y: +m[1], m: +m[2], d: +m[3], ms: Number.isFinite(ms) ? ms : Date.UTC(+m[1], +m[2] - 1, +m[3]) };
    }
    if (!Number.isFinite(ms)) return null;
    const dt = new Date(ms);
    return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), ms };
  }
  const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(t)) return null;
  const dt = new Date(t);
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), ms: t };
}

const UNIT_MS: Record<string, number> = {
  milliseconds: 1, seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000,
};
function dateDiff(a: any, b: any, unit: string): number | null {
  const p = dateParts(a);
  const q = dateParts(b);
  if (!p || !q) return null;
  let u = unit.trim().toLowerCase();
  if (!u.endsWith('s')) u += 's';
  if (u === 'ms') u = 'milliseconds';
  if (u === 'months' || u === 'years') {
    let months = p.y * 12 + p.m - (q.y * 12 + q.m);
    if (months > 0 && p.d < q.d) months--;
    else if (months < 0 && p.d > q.d) months++;
    return u === 'months' ? months : Math.trunc(months / 12);
  }
  const f = UNIT_MS[u];
  if (!f) return null;
  return (p.ms - q.ms) / f;
}

// ---------------------------------------------------------------------------
// Function table
// ---------------------------------------------------------------------------

interface FnDef {
  key: string; // lower-case lookup name
  doc: ExprFunctionDoc;
  min: number;
  max: number;
  lazy: boolean;
  run: (args: any[], f: ExprFeature) => any;
  /** For lazy functions: args are thunks. */
  runLazy?: (args: Node[], f: ExprFeature) => any;
}

const FUNCS = new Map<string, FnDef>();
const DOCS: ExprFunctionDoc[] = [];

function def(
  category: string,
  signature: string,
  description: string,
  run: (a: any[], f: ExprFeature) => any,
  opts: { key?: string; min?: number; max?: number; lazy?: (a: Node[], f: ExprFeature) => any } = {},
) {
  const name = signature.slice(0, signature.indexOf('('));
  const params = signature
    .slice(signature.indexOf('(') + 1, signature.lastIndexOf(')'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const variadic = params.includes('...');
  const required = params.filter((p) => p !== '...' && !p.endsWith('?')).length;
  const fn: FnDef = {
    key: opts.key ?? name.toLowerCase(),
    doc: { name, signature, description, category },
    min: opts.min ?? required,
    max: opts.max ?? (variadic ? Infinity : params.length),
    lazy: !!opts.lazy,
    run,
    runLazy: opts.lazy,
  };
  FUNCS.set(fn.key, fn);
  DOCS.push(fn.doc);
}
const alias = (name: string, target: string) => {
  const t = FUNCS.get(target.toLowerCase())!;
  FUNCS.set(name.toLowerCase(), t);
};

const math1 = (cat: string, name: string, desc: string, fn: (x: number) => number) =>
  def(cat, `${name}(number)`, desc, ([x]) => {
    const n = num(x);
    return n === null ? null : fn(n);
  });

// --- Math
def('Math', 'Round(number, decimals?)', 'Round half away from zero to a number of decimals (default 0).', ([x, d]) => {
  const n = num(x);
  return n === null ? null : round(n, d === undefined ? 0 : num(d) ?? 0);
});
math1('Math', 'Abs', 'Absolute value.', Math.abs);
math1('Math', 'Floor', 'Largest integer not greater than the number.', Math.floor);
math1('Math', 'Ceil', 'Smallest integer not less than the number.', Math.ceil);
math1('Math', 'Trunc', 'Integer part of the number.', Math.trunc);
math1('Math', 'Sqrt', 'Square root.', Math.sqrt);
math1('Math', 'Exp', 'e raised to the power of the number.', Math.exp);
math1('Math', 'Log', 'Natural logarithm.', Math.log);
math1('Math', 'Log10', 'Base-10 logarithm.', Math.log10);
math1('Math', 'Sin', 'Sine (radians).', Math.sin);
math1('Math', 'Cos', 'Cosine (radians).', Math.cos);
math1('Math', 'Tan', 'Tangent (radians).', Math.tan);
math1('Math', 'Sign', 'Sign of the number: -1, 0 or 1.', Math.sign);
def('Math', 'Pow(base, exponent)', 'Base raised to the exponent.', ([a, b]) => {
  const x = num(a);
  const y = num(b);
  return x === null || y === null ? null : x ** y;
});
def('Math', 'Mod(a, b)', 'Remainder of a divided by b.', ([a, b]) => {
  const x = num(a);
  const y = num(b);
  return x === null || y === null || y === 0 ? null : x % y;
});
def('Math', 'Min(a, b, ...)', 'Smallest of the numeric arguments (nulls ignored).', (args) => {
  const ns = args.map(num).filter((x): x is number => x !== null);
  return ns.length ? Math.min(...ns) : null;
});
def('Math', 'Max(a, b, ...)', 'Largest of the numeric arguments (nulls ignored).', (args) => {
  const ns = args.map(num).filter((x): x is number => x !== null);
  return ns.length ? Math.max(...ns) : null;
});
def('Math', 'Pi()', 'The constant pi.', () => Math.PI);
def('Math', 'Random()', 'Random number in [0, 1).', () => Math.random());

// --- Text
const text1 = (name: string, desc: string, fn: (s: string) => any) =>
  def('Text', `${name}(text)`, desc, ([v]) => (v === null || v === undefined ? null : fn(str(v))));
text1('Upper', 'Convert to upper case.', (s) => s.toUpperCase());
text1('Lower', 'Convert to lower case.', (s) => s.toLowerCase());
text1('Trim', 'Remove leading and trailing whitespace.', (s) => s.trim());
text1('Proper', 'Title case: capitalise the first letter of each word.', (s) =>
  s.toLowerCase().replace(/((?:^|[\s\-(/])|(?<=(?:^|[\s\-(/])\p{L})')(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase()),
);
def('Text', 'Length(text)', 'Number of characters in the text.', ([v]) => (v === null || v === undefined ? null : str(v).length), { key: 'length', max: 1 });
alias('Len', 'Length');
def('Text', 'Left(text, count)', 'First characters of the text.', ([v, n]) => {
  const c = num(n);
  return v === null || v === undefined || c === null ? null : str(v).slice(0, Math.max(0, c));
});
def('Text', 'Right(text, count)', 'Last characters of the text.', ([v, n]) => {
  const c = num(n);
  if (v === null || v === undefined || c === null) return null;
  const s = str(v);
  return c <= 0 ? '' : s.slice(Math.max(0, s.length - c));
});
def('Text', 'Mid(text, start, count?)', 'Substring from a 1-based start position.', ([v, s, c]) => {
  const st = num(s);
  if (v === null || v === undefined || st === null) return null;
  const from = Math.max(0, st - 1);
  const t = str(v);
  const len = c === undefined ? undefined : num(c);
  return len === undefined ? t.slice(from) : len === null ? null : t.substr(from, Math.max(0, len));
});
def('Text', 'Replace(text, find, replacement)', 'Replace every occurrence of a literal substring.', ([v, a, b]) =>
  v === null || v === undefined ? null : str(v).split(str(a)).join(str(b)),
);
def('Text', 'Concatenate(text1, text2, ...)', 'Join values as text (nulls become empty).', (args) => args.map(str).join(''), { min: 1 });
def('Text', 'Find(search, text, start?)', '1-based position of search within text, or 0 if absent.', ([a, t, s]) => {
  if (t === null || t === undefined) return null;
  const from = s === undefined ? 0 : Math.max(0, (num(s) ?? 1) - 1);
  return str(t).indexOf(str(a), from) + 1;
});
def('Text', 'Contains(text, search)', 'True if the text contains the substring (case-insensitive).', ([t, s]) =>
  t === null || t === undefined ? false : str(t).toLowerCase().includes(str(s).toLowerCase()),
);
def('Text', 'StartsWith(text, prefix)', 'True if the text starts with the prefix (case-insensitive).', ([t, s]) =>
  t === null || t === undefined ? false : str(t).toLowerCase().startsWith(str(s).toLowerCase()),
);
def('Text', 'EndsWith(text, suffix)', 'True if the text ends with the suffix (case-insensitive).', ([t, s]) =>
  t === null || t === undefined ? false : str(t).toLowerCase().endsWith(str(s).toLowerCase()),
);
def('Text', 'Text(value, decimals?)', 'Convert a value to text, optionally with a fixed number of decimals.', ([v, d]) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && d !== undefined) {
    const dec = num(d);
    return dec === null ? String(v) : round(v, dec).toFixed(Math.max(0, Math.min(20, Math.trunc(dec))));
  }
  return str(v);
});
def('Text', 'Number(value)', 'Convert text to a number (null when not numeric).', ([v]) => num(v));

// --- Logic
const isEmpty = (v: any) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (typeof v === 'number' && Number.isNaN(v));
def('Logic', 'IsEmpty(value)', 'True when the value is null or an empty string.', ([v]) => isEmpty(v));
def('Logic', 'DefaultValue(value, default)', 'The value, or the default when it is null or empty.', ([v, d]) => (isEmpty(v) ? d : v));
def('Logic', 'IIf(condition, then, else)', 'Return one of two values depending on the condition.', () => null, {
  lazy: (a, f) => (truthy(a[0](f)) ? a[1](f) : a[2](f)),
});
def('Logic', 'When(cond1, value1, ..., default)', 'First value whose condition is true; the last odd argument is the default.', () => null, {
  min: 2,
  lazy: (a, f) => {
    let i = 0;
    for (; i + 1 < a.length; i += 2) if (truthy(a[i](f))) return a[i + 1](f);
    return i < a.length ? a[i](f) : null;
  },
});
def('Logic', 'Coalesce(a, b, ...)', 'First argument that is not null or empty.', () => null, {
  min: 1,
  lazy: (a, f) => {
    for (const n of a) {
      const v = n(f);
      if (!isEmpty(v)) return v;
    }
    return null;
  },
});

// --- Date
def('Date', 'Now()', 'Current date and time (ISO 8601, UTC).', () => new Date().toISOString());
def('Date', 'Today()', "Today's date (YYYY-MM-DD, local).", () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});
def('Date', 'Year(date)', 'Year of a date.', ([v]) => dateParts(v)?.y ?? null);
def('Date', 'Month(date)', 'Month of a date (1-12).', ([v]) => dateParts(v)?.m ?? null);
def('Date', 'Day(date)', 'Day of the month (1-31).', ([v]) => dateParts(v)?.d ?? null);
def('Date', 'DateDiff(date1, date2, unit)', "date1 minus date2 in 'years', 'months', 'weeks', 'days', 'hours', 'minutes' or 'seconds'.", ([a, b, u]) =>
  dateDiff(a, b, str(u)),
);

// --- Geometry
def('Geometry', 'Area(unit?)', "Geodesic polygon area. Unit: 'sqm' (default), 'sqkm', 'ha', 'acres', 'sqmi', 'sqft'.", ([u], f) => {
  const a = geomArea(f.geometry);
  if (a === null) return null;
  const k = AREA_UNITS[u === undefined ? 'sqm' : str(u).toLowerCase()];
  return k === undefined ? null : a * k;
});
def('Geometry', 'Length(unit?)', "Geodesic line length, or polygon perimeter. Unit: 'm' (default), 'km', 'mi', 'ft'.", ([u], f) => {
  const l = geomLength(f.geometry);
  if (l === null) return null;
  const k = LENGTH_UNITS[u === undefined ? 'm' : str(u).toLowerCase()];
  return k === undefined ? null : l * k;
}, { key: 'length$geom' });
alias('Perimeter', 'length$geom');
def('Geometry', 'X()', 'Longitude of the feature centroid.', (_a, f) => geomCentroid(f.geometry)?.[0] ?? null);
def('Geometry', 'Y()', 'Latitude of the feature centroid.', (_a, f) => geomCentroid(f.geometry)?.[1] ?? null);
def('Geometry', 'PointCount()', 'Number of vertices in the feature geometry.', (_a, f) => (f.geometry ? countPoints(f.geometry) : null));
def('Geometry', 'FID()', 'Feature id.', (_a, f) => f.id ?? null);

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

const LENGTH_UNIT_NAMES = new Set(Object.keys(LENGTH_UNITS));

function gen(ast: Ast): Node {
  switch (ast.t) {
    case 'num':
    case 'str':
    case 'bool': {
      const v = ast.v;
      return () => v;
    }
    case 'null':
      return () => null;
    case 'field': {
      const name = ast.name;
      return (f) => getField(f, name);
    }
    case 'dyn': {
      const e = gen(ast.expr);
      return (f) => {
        const k = e(f);
        return k === null || k === undefined ? null : getField(f, str(k));
      };
    }
    case 'neg': {
      const a = gen(ast.a);
      return (f) => {
        const n = num(a(f));
        return n === null ? null : -n;
      };
    }
    case 'not': {
      const a = gen(ast.a);
      return (f) => !truthy(a(f));
    }
    case 'logic': {
      const a = gen(ast.a);
      const b = gen(ast.b);
      return ast.op === 'and' ? (f) => truthy(a(f)) && truthy(b(f)) : (f) => truthy(a(f)) || truthy(b(f));
    }
    case 'cmp': {
      const a = gen(ast.a);
      const b = gen(ast.b);
      switch (ast.op) {
        case '=':
        case '==':
          return (f) => compare(a(f), b(f)) === 0;
        case '!=':
        case '<>':
          return (f) => {
            const c = compare(a(f), b(f));
            return c !== null && c !== 0;
          };
        case '<':
          return (f) => {
            const c = compare(a(f), b(f));
            return c !== null && c < 0;
          };
        case '<=':
          return (f) => {
            const c = compare(a(f), b(f));
            return c !== null && c <= 0;
          };
        case '>':
          return (f) => {
            const c = compare(a(f), b(f));
            return c !== null && c > 0;
          };
        default:
          return (f) => {
            const c = compare(a(f), b(f));
            return c !== null && c >= 0;
          };
      }
    }
    case 'bin': {
      const a = gen(ast.a);
      const b = gen(ast.b);
      switch (ast.op) {
        case '+':
          return (f) => {
            const x = a(f);
            const y = b(f);
            if (typeof x === 'string' || typeof y === 'string') return str(x) + str(y);
            const nx = num(x);
            const ny = num(y);
            return nx === null || ny === null ? null : nx + ny;
          };
        case '-':
          return (f) => {
            const nx = num(a(f));
            const ny = num(b(f));
            return nx === null || ny === null ? null : nx - ny;
          };
        case '*':
          return (f) => {
            const nx = num(a(f));
            const ny = num(b(f));
            return nx === null || ny === null ? null : nx * ny;
          };
        case '/':
          return (f) => {
            const nx = num(a(f));
            const ny = num(b(f));
            return nx === null || ny === null || ny === 0 ? null : nx / ny;
          };
        default:
          return (f) => {
            const nx = num(a(f));
            const ny = num(b(f));
            return nx === null || ny === null || ny === 0 ? null : nx % ny;
          };
      }
    }
    case 'like': {
      const a = gen(ast.a);
      const neg = ast.neg;
      if (ast.p.t === 'str') {
        const re = likeRegex(ast.p.v);
        return (f) => {
          const v = a(f);
          if (v === null || v === undefined) return false;
          return re.test(str(v)) !== neg;
        };
      }
      const p = gen(ast.p);
      return (f) => {
        const v = a(f);
        const pat = p(f);
        if (v === null || v === undefined || pat === null || pat === undefined) return false;
        return likeRegex(str(pat)).test(str(v)) !== neg;
      };
    }
    case 'in': {
      const a = gen(ast.a);
      const list = ast.list.map(gen);
      const neg = ast.neg;
      return (f) => {
        const v = a(f);
        if (v === null || v === undefined) return false;
        let found = false;
        for (const n of list) {
          if (compare(v, n(f)) === 0) {
            found = true;
            break;
          }
        }
        return found !== neg;
      };
    }
    case 'isnull': {
      const a = gen(ast.a);
      const neg = ast.neg;
      return (f) => {
        const v = a(f);
        return (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) !== neg;
      };
    }
    case 'between': {
      const a = gen(ast.a);
      const lo = gen(ast.lo);
      const hi = gen(ast.hi);
      const neg = ast.neg;
      return (f) => {
        const v = a(f);
        const c1 = compare(v, lo(f));
        const c2 = compare(v, hi(f));
        if (c1 === null || c2 === null) return false;
        return (c1 >= 0 && c2 <= 0) !== neg;
      };
    }
    case 'call': {
      let key = ast.name.toLowerCase();
      // Length is both text length and geometry length: pick by argument shape.
      if (key === 'length') {
        const a0 = ast.args[0];
        if (ast.args.length === 0 || (ast.args.length === 1 && a0.t === 'str' && LENGTH_UNIT_NAMES.has(a0.v.toLowerCase())))
          key = 'length$geom';
      }
      const fn = FUNCS.get(key);
      if (!fn) throw new ExprError(`Unknown function ${ast.name}`, ast.pos);
      const n = ast.args.length;
      if (n < fn.min || n > fn.max) {
        const range = fn.max === Infinity ? `at least ${fn.min}` : fn.min === fn.max ? `${fn.min}` : `${fn.min}-${fn.max}`;
        throw new ExprError(`${fn.doc.name} expects ${range} argument${fn.max === 1 && fn.min === 1 ? '' : 's'}`, ast.pos);
      }
      const args = ast.args.map(gen);
      if (fn.runLazy) {
        const run = fn.runLazy;
        return (f) => run(args, f);
      }
      const run = fn.run;
      if (n === 0) return (f) => finite(run([], f));
      if (n === 1) {
        const a0 = args[0];
        return (f) => finite(run([a0(f)], f));
      }
      return (f) => finite(run(args.map((x) => x(f)), f));
    }
  }
}

function finite(v: any) {
  return typeof v === 'number' && !Number.isFinite(v) ? null : v === undefined ? null : v;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function parseSource(source: string): Ast | null {
  const src = source.trim();
  if (!src) return null;
  return new Parser(tokenize(src)).parse();
}

/** Compile an expression; throws ExprError on syntax errors. Evaluation never throws (errors yield null). */
export function compileExpr(source: string): Compiled {
  const ast = parseSource(source);
  if (!ast) return () => null;
  const node = gen(ast);
  return (f) => {
    try {
      const v = node(f);
      return v === undefined ? null : v;
    } catch {
      return null;
    }
  };
}

/** Non-throwing compile. */
export function tryCompile(source: string): { fn?: Compiled; error?: string } {
  try {
    return { fn: compileExpr(source) };
  } catch (e: any) {
    const pos = e instanceof ExprError && e.position !== undefined ? ` (at ${e.position + 1})` : '';
    return { error: (e?.message ?? String(e)) + pos };
  }
}

/** Compile a where-clause to a boolean predicate (empty source matches everything). Throws ExprError. */
export function compileWhere(source: string): (feature: ExprFeature) => boolean {
  if (!source.trim()) return () => true;
  const fn = compileExpr(source);
  return (f) => truthy(fn(f));
}

/** Field names referenced by an expression (best effort; empty when the source does not parse). */
export function referencedFields(source: string): string[] {
  let ast: Ast | null;
  try {
    ast = parseSource(source);
  } catch {
    return [];
  }
  const out = new Set<string>();
  const walk = (a: any) => {
    if (!a || typeof a !== 'object') return;
    if (Array.isArray(a)) return a.forEach(walk);
    if (a.t === 'field') out.add(a.name);
    for (const k in a) if (k !== 't') walk(a[k]);
  };
  walk(ast);
  return [...out];
}

/** Documentation for the built-in functions (for expression builders). */
export function listFunctions(): ExprFunctionDoc[] {
  return DOCS.map((d) => ({ ...d }));
}
