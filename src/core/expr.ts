// Terrane expression language — PUBLIC CONTRACT (implementation is a placeholder
// until the real engine lands; keep these exported signatures).
//
// One language serves where-clauses (definition queries, Select By Attributes),
// label expressions and the field calculator:
//   POP > 1000000 AND NAME LIKE 'A%'
//   NAME + " (" + Round(POP / 1e6, 1) + "M)"
// Fields: bare identifier, [Field With Spaces], or $feature.NAME. Strings: '..' or "..".
import type { Geometry } from 'geojson';

export interface ExprFeature {
  id?: number | string;
  properties: Record<string, any> | null;
  geometry?: Geometry | null;
}
export type Compiled = (feature: ExprFeature) => any;

export class ExprError extends Error {
  constructor(message: string, public position?: number) {
    super(message);
  }
}

export interface ExprFunctionDoc {
  name: string;
  signature: string;
  description: string;
  category: string;
}

/** Compile an expression; throws ExprError on syntax errors. Evaluation never throws (errors yield null). */
export function compileExpr(source: string): Compiled {
  const src = source.trim();
  if (!src) return () => null;
  const m = /^(?:\$feature\.)?([A-Za-z_][A-Za-z0-9_]*)$/.exec(src) ?? /^\[(.+)\]$/.exec(src);
  if (m) return (f) => f.properties?.[m[1]] ?? null;
  return () => null;
}

/** Non-throwing compile. */
export function tryCompile(source: string): { fn?: Compiled; error?: string } {
  try {
    return { fn: compileExpr(source) };
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}

/** Compile a where-clause to a boolean predicate (empty source matches everything). Throws ExprError. */
export function compileWhere(source: string): (feature: ExprFeature) => boolean {
  if (!source.trim()) return () => true;
  const fn = compileExpr(source);
  return (f) => !!fn(f);
}

/** Field names referenced by an expression (best effort). */
export function referencedFields(_source: string): string[] {
  return [];
}

/** Documentation for the built-in functions (for expression builders). */
export function listFunctions(): ExprFunctionDoc[] {
  return [];
}
