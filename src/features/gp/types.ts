// Geoprocessing framework types. Everything in this file (and in tools/*, geo.ts,
// exec.ts) is PURE: plain GeoJSON in, plain GeoJSON out. No React, OL or store,
// so tools run in a Web Worker and in node tests.
import type { Geometry } from 'geojson';
import type { Field, FieldType, GeomType } from '../../core/types';

export type { Field, FieldType, GeomType };

export type LinearUnit = 'm' | 'km' | 'ft' | 'mi';
export interface Distance {
  value: number;
  unit: LinearUnit;
}

export type StatName = 'sum' | 'mean' | 'min' | 'max' | 'range' | 'std' | 'median' | 'count' | 'first' | 'last';
export interface StatSpec {
  field: string;
  stat: StatName;
}

/** A feature as seen by tools. `id` is the source FID (when known). Never mutate inputs. */
export interface GpFeature {
  type: 'Feature';
  id?: number | string;
  geometry: Geometry | null;
  properties: Record<string, any>;
}

/** A resolved input layer: only the features that should be processed. */
export interface LayerData {
  name: string;
  geomType: GeomType | null;
  fields: Field[];
  features: GpFeature[];
}

export interface ToolResult {
  /** Overrides the default output name when set. */
  name?: string;
  geomType: GeomType | null;
  fields: Field[];
  features: GpFeature[];
}

export interface ToolContext {
  inputs: Record<string, LayerData[]>;
  params: Record<string, any>;
  progress(fraction: number, message?: string): void;
  message(text: string, level?: 'info' | 'warning'): void;
  /** The (single) layer bound to a layer parameter. Throws a readable error when missing. */
  layer(name: string): LayerData;
  layerOpt(name: string): LayerData | undefined;
}

// ---------- parameters ----------

interface ParamBase {
  name: string;
  label: string;
  help: string;
  optional?: boolean;
  /** Hide the parameter unless this returns true for the current values. */
  showIf?: (values: Record<string, any>) => boolean;
}

export type LayerGeomFilter = GeomType | 'Table';

export type ParamDef =
  | (ParamBase & { kind: 'layer'; geom?: LayerGeomFilter[]; multiple?: boolean })
  | (ParamBase & { kind: 'field'; layer: string; types?: FieldType[]; allowNone?: boolean })
  | (ParamBase & { kind: 'fields'; layer: string; types?: FieldType[] })
  | (ParamBase & { kind: 'stats'; layer: string; types?: FieldType[]; stats?: StatName[] })
  | (ParamBase & { kind: 'number'; default: number; min?: number; max?: number; step?: number; integer?: boolean })
  | (ParamBase & { kind: 'distance'; default: Distance; min?: number })
  | (ParamBase & { kind: 'string'; default: string; placeholder?: string })
  | (ParamBase & { kind: 'choice'; default: string; options: Array<{ value: string; label: string }> })
  | (ParamBase & { kind: 'multichoice'; default: string[]; options: Array<{ value: string; label: string }> })
  | (ParamBase & { kind: 'boolean'; default: boolean })
  | (ParamBase & { kind: 'where'; layer: string })
  | (ParamBase & { kind: 'output'; placeholder?: string });

export interface ToolDef {
  id: string;
  name: string;
  category: string;
  description: string;
  keywords: string[];
  params: ParamDef[];
  /** Prefix for the default output name (`<prefix>_<first input layer>`); defaults to the tool name without spaces. */
  outputPrefix?: string;
  run(ctx: ToolContext): ToolResult;
}

export class ToolError extends Error {}

export const CATEGORIES = [
  'Overlay',
  'Proximity',
  'Features',
  'Generalization',
  'Statistics',
  'Density & Surfaces',
  'Generate',
] as const;
