import { describe, expect, it } from 'vitest';
import type { Dataset, FeatureLayer, SymbolDef } from '../../core/types';
import { makeStyleFunction } from '../../map/style';
import { rangeClasses } from './classify';

const sym = (fill: string, shape: SymbolDef['shape'] = 'circle'): SymbolDef => ({ fill, fillOpacity: 1, stroke: '#000000', strokeWidth: 1, size: 5, shape });
const feature = (props: Record<string, any>) => ({ get: (k: string) => (k === 'feat' ? { id: 1, properties: props, geometry: null } : undefined), getGeometry: () => undefined }) as any;
const ds = { id: 'd', name: 'd', geomType: 'Point', fields: [], features: [], nextFid: 1 } as Dataset;
const layer = (renderer: any, labels: any = { enabled: false, expression: '', fontSize: 12, color: '#000000', haloColor: '#ffffff', haloWidth: 2 }) =>
  ({ id: 'l', kind: 'feature', name: 'l', visible: true, opacity: 1, datasetId: 'd', renderer, labels, selectable: true, editable: true }) as FeatureLayer;

describe('makeStyleFunction', () => {
  it('single returns one cached style', () => {
    const fn = makeStyleFunction(layer({ type: 'single', symbol: sym('#ff0000') }), ds);
    expect(fn(feature({}), 1)).toBe(fn(feature({}), 1));
  });
  it('unique maps values, hides unchecked classes and falls back to default', () => {
    const r = {
      type: 'unique', field: 'k', defaultSymbol: sym('#999999'),
      classes: [{ value: 'a', label: 'a', symbol: sym('#ff0000') }, { value: 'b', label: 'b', symbol: sym('#00ff00'), visible: false }, { value: '', label: 'null', symbol: sym('#0000ff', 'star') }],
    };
    const fn = makeStyleFunction(layer(r), ds);
    const a = fn(feature({ k: 'a' }), 1);
    const other = fn(feature({ k: 'zzz' }), 1);
    expect(a).toBeDefined();
    expect(a).not.toBe(other);
    expect(fn(feature({ k: 'b' }), 1)).toBeUndefined();
    expect(fn(feature({ k: null }), 1)).toBeDefined();
    expect(fn(feature({ k: null }), 1)).not.toBe(other);
  });
  it('graduated picks the class and skips invalid values', () => {
    const classes = rangeClasses({ min: 0, max: 30, uppers: [10, 20, 30] }, [sym('#111111'), sym('#222222'), sym('#333333')]);
    const fn = makeStyleFunction(layer({ type: 'graduated', field: 'v', method: 'manual', classes, ramp: 'Blues', base: sym('#000000') }), ds);
    const lo = fn(feature({ v: 5 }), 1);
    const mid = fn(feature({ v: 15 }), 1);
    expect(lo).not.toBe(mid);
    expect(fn(feature({ v: 10 }), 1)).toBe(lo);
    expect(fn(feature({ v: 31 }), 1)).toBeUndefined();
    expect(fn(feature({ v: null }), 1)).toBeUndefined();
  });
  it('graduated honours a normalization field', () => {
    const classes = rangeClasses({ min: 0, max: 2, uppers: [1, 2] }, [sym('#111111'), sym('#222222')]);
    const fn = makeStyleFunction(layer({ type: 'graduated', field: 'v', normalization: 'n', method: 'manual', classes, ramp: 'Blues', base: sym('#000000') }), ds);
    expect(fn(feature({ v: 3, n: 2 }), 1)).not.toBe(fn(feature({ v: 1, n: 2 }), 1)); // 1.5 and 0.5 land in different classes
    expect(fn(feature({ v: 3, n: 4 }), 1)).toBeDefined();
    expect(fn(feature({ v: 3, n: 0 }), 1)).toBeUndefined();
  });
  it('proportional buckets sizes and skips null', () => {
    const r = { type: 'proportional', field: 'v', minValue: 0, maxValue: 100, minSize: 2, maxSize: 12, symbol: sym('#ff0000') };
    const fn = makeStyleFunction(layer(r), ds);
    const small = fn(feature({ v: 1 }), 1) as any;
    const big = fn(feature({ v: 100 }), 1) as any;
    expect(big.getImage().getRadius()).toBeGreaterThan(small.getImage().getRadius());
    expect(fn(feature({ v: null }), 1)).toBeUndefined();
  });
  it('heatmap draws nothing here', () => {
    const fn = makeStyleFunction(layer({ type: 'heatmap', radius: 10, blur: 10, ramp: 'Heat' }), ds);
    const s = fn(feature({}), 1) as any;
    expect(s.getImage()).toBeNull();
    expect(s.getFill()).toBeNull();
  });
  it('labels set text per feature and respect the zoom range', () => {
    const labels = { enabled: true, expression: 'name', fontSize: 12, color: '#000000', haloColor: '#ffffff', haloWidth: 2, minZoom: 5 };
    const fn = makeStyleFunction(layer({ type: 'single', symbol: sym('#ff0000') }, labels), ds);
    const f1 = feature({ name: 'Oslo' });
    const s = fn(f1, 100) as any; // resolution 100 ~ zoom 10.6: inside range
    expect(s.getText().getText()).toBe('Oslo');
    fn(feature({ name: 'Rome' }), 100);
    expect(s.getText().getText()).toBe('Rome');
    fn(f1, 156543.034 / 2 ** 3); // zoom 3: below min zoom
    expect(s.getText().getText()).toBe('');
  });
});
