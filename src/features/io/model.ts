// Shared types for the io module.
import type { Feature as GJFeature, Geometry } from 'geojson';
import type { Field } from '../../core/types';

/** GeoJSON feature whose geometry may be missing (attribute-only rows). */
export type Feature = GJFeature<Geometry | null, Record<string, any>>;

/** One importable layer produced by a parser (geometry already in EPSG:4326). */
export interface ParsedLayer {
  name: string;
  features: Feature[];
  /** Optional explicit schema (otherwise inferred). */
  fields?: Field[];
  /** Notes to show the user (e.g. skipped rows). */
  warnings?: string[];
}

/** A raster file to import (kept as a blob). */
export interface ParsedRaster {
  name: string;
  blob: Blob;
  /** lon/lat extent if it could be determined. */
  extent?: [number, number, number, number];
}

export interface ParseResult {
  layers: ParsedLayer[];
  rasters: ParsedRaster[];
}

export const emptyResult = (): ParseResult => ({ layers: [], rasters: [] });

export function baseName(file: string): string {
  const n = file.split(/[\\/]/).pop() ?? file;
  const i = n.lastIndexOf('.');
  return i > 0 ? n.slice(0, i) : n;
}
export function extOf(file: string): string {
  const n = (file.split(/[?#]/)[0].split(/[\\/]/).pop() ?? '').toLowerCase();
  const i = n.lastIndexOf('.');
  return i >= 0 ? n.slice(i + 1) : '';
}
