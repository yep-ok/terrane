// Small constructors that keep tool definitions short.
import type { Distance, FieldType, LayerGeomFilter, ParamDef, StatName } from './types';

type Base = { help: string; optional?: boolean; showIf?: (v: Record<string, any>) => boolean };

export const layerP = (name: string, label: string, b: Base & { geom?: LayerGeomFilter[]; multiple?: boolean }): ParamDef => ({ kind: 'layer', name, label, ...b });
export const fieldP = (name: string, label: string, layer: string, b: Base & { types?: FieldType[]; allowNone?: boolean }): ParamDef => ({ kind: 'field', name, label, layer, ...b });
export const fieldsP = (name: string, label: string, layer: string, b: Base & { types?: FieldType[] }): ParamDef => ({ kind: 'fields', name, label, layer, optional: true, ...b });
export const statsP = (name: string, label: string, layer: string, b: Base & { types?: FieldType[]; stats?: StatName[] }): ParamDef => ({ kind: 'stats', name, label, layer, optional: true, types: ['number', 'integer'], ...b });
export const numP = (name: string, label: string, def: number, b: Base & { min?: number; max?: number; step?: number; integer?: boolean }): ParamDef => ({ kind: 'number', name, label, default: def, ...b });
export const distP = (name: string, label: string, def: Distance, b: Base & { min?: number }): ParamDef => ({ kind: 'distance', name, label, default: def, ...b });
export const strP = (name: string, label: string, def: string, b: Base & { placeholder?: string }): ParamDef => ({ kind: 'string', name, label, default: def, ...b });
export const choiceP = (name: string, label: string, def: string, options: Array<[string, string]>, b: Base): ParamDef => ({
  kind: 'choice', name, label, default: def, options: options.map(([value, label]) => ({ value, label })), ...b,
});
export const multiP = (name: string, label: string, def: string[], options: Array<[string, string]>, b: Base): ParamDef => ({
  kind: 'multichoice', name, label, default: def, options: options.map(([value, label]) => ({ value, label })), ...b,
});
export const boolP = (name: string, label: string, def: boolean, b: Base): ParamDef => ({ kind: 'boolean', name, label, default: def, ...b });
export const whereP = (name: string, label: string, layer: string, b: Base): ParamDef => ({ kind: 'where', name, label, layer, optional: true, ...b });
export const outP = (help = 'Name of the layer that will be added to the map. Leave blank to use an automatic name.'): ParamDef => ({
  kind: 'output', name: 'output', label: 'Output name', optional: true, help,
});

export const ANY_GEOM: LayerGeomFilter[] = ['Point', 'LineString', 'Polygon'];
export const POLY: LayerGeomFilter[] = ['Polygon'];
export const LINE: LayerGeomFilter[] = ['LineString'];
export const POINT: LayerGeomFilter[] = ['Point'];
export const ANY_OR_TABLE: LayerGeomFilter[] = ['Point', 'LineString', 'Polygon', 'Table'];
export const NUMERIC: FieldType[] = ['number', 'integer'];

export const UNIT_OPTIONS: Array<[string, string]> = [['m', 'Meters'], ['km', 'Kilometers'], ['ft', 'Feet'], ['mi', 'Miles']];
