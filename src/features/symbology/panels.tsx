// Renderer-specific editors shown in the Symbology pane. All state lives in layer.renderer;
// every change calls apply(renderer), which writes it to the project store.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, FlipHorizontal2, ListPlus, RotateCcw, Trash2, X } from 'lucide-react';
import type { ClassMethod, Dataset, FeatureLayer, GeomType, RangeClass, Renderer, SymbolDef, UniqueClass } from '../../core/types';
import { useDatasetVersion } from '../../core/data';
import { Button, FieldSelect, IconButton, NUMERIC, Row, Select, Slider, cx, formatNumber, openMenuAt } from '../../ui/kit';
import { SymbolSwatch } from './legend';
import { CommitNumber, RampPicker, SymbolEditor } from './controls';
import { collectNumbers, histogram, MAX_UNIQUE_CLASSES, relabel, setUpperBound, uniqueLabel, uniqueValues } from './classify';
import { rampColors } from './ramps';
import {
  METHOD_LABELS, baseSymbolOf, buildGraduated, buildProportional, buildUnique, dataRange, recolor, recolorClasses, symbolColor,
} from './renderers';

export interface PanelProps<R extends Renderer> {
  layer: FeatureLayer;
  ds: Dataset;
  r: R;
  apply(r: Renderer): void;
}

// ---------- single ----------

export function SinglePanel({ ds, r, apply }: PanelProps<Extract<Renderer, { type: 'single' }>>) {
  return (
    <>
      <SymbolEditor symbol={r.symbol} geomType={ds.geomType} onChange={(symbol) => apply({ ...r, symbol })} />
      <Row label="Legend label"><input className="input" value={r.label ?? ''} placeholder="(none)" onChange={(e) => apply({ ...r, label: e.target.value || undefined })} /></Row>
    </>
  );
}

// ---------- class row ----------

function ClassRow({
  symbol, geom, label, onLabel, onSymbol, trailing, leading, open, onToggle, off,
}: {
  symbol: SymbolDef; geom: GeomType | null; label: string; onLabel?: (l: string) => void; onSymbol: (s: SymbolDef) => void;
  trailing?: React.ReactNode; leading?: React.ReactNode; open: boolean; onToggle: () => void; off?: boolean;
}) {
  return (
    <div className="sy-class">
      <div className={cx('sy-class-row', off && 'off')}>
        {leading}
        <button type="button" className={cx('sy-swatch', open && 'open')} onClick={onToggle} title="Edit symbol">
          <SymbolSwatch symbol={symbol} geomType={geom} />
        </button>
        {onLabel ? (
          <input className="sy-class-label" value={label} spellCheck={false} onChange={(e) => onLabel(e.target.value)} title="Legend label" />
        ) : (
          <span className="grow" style={{ padding: '0 5px' }}>{label}</span>
        )}
        {trailing}
      </div>
      {open && (
        <div className="sy-class-edit">
          <SymbolEditor symbol={symbol} geomType={geom} onChange={onSymbol} compact />
        </div>
      )}
    </div>
  );
}

// ---------- unique values ----------

export function UniquePanel({ ds, r, apply }: PanelProps<Extract<Renderer, { type: 'unique' }>>) {
  const version = useDatasetVersion(ds.id);
  const geom = ds.geomType;
  const [open, setOpen] = useState<string | null>(null);
  const ramp = r.ramp ?? 'Category10';
  const all = useMemo(() => (r.field ? uniqueValues(ds.features, r.field) : { values: [], total: 0 }), [ds, version, r.field]);
  const counts = useMemo(() => new Map(all.values.map((v) => [v.value, v.count])), [all]);
  const base = r.defaultSymbol ?? r.classes[0]?.symbol ?? baseSymbolOf({ renderer: r } as FeatureLayer, ds);
  const setClasses = (classes: UniqueClass[]) => apply({ ...r, classes });
  const present = new Set(r.classes.map((c) => c.value));
  const missing = all.values.filter((v) => !present.has(v.value));

  const addAll = () => {
    const built = buildUnique(ds, r.field, ramp, base);
    if (built.type !== 'unique') return;
    const existing = new Map(r.classes.map((c) => [c.value, c]));
    apply({ ...r, classes: built.classes.map((c) => existing.get(c.value) ?? c), defaultSymbol: r.defaultSymbol ?? built.defaultSymbol });
  };
  const sortMenu = (el: Element) =>
    openMenuAt(el, [
      { label: 'Sort by value', onClick: () => setClasses([...r.classes].sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }))) },
      { label: 'Sort by count (high first)', onClick: () => setClasses([...r.classes].sort((a, b) => (counts.get(b.value) ?? 0) - (counts.get(a.value) ?? 0))) },
      { label: 'Reverse order', onClick: () => setClasses([...r.classes].reverse()) },
      'separator',
      {
        label: 'Reapply colour ramp',
        onClick: () => {
          const cols = rampColors(ramp, r.classes.length);
          setClasses(r.classes.map((c, i) => ({ ...c, symbol: recolor(c.symbol, geom, cols[i]) })));
        },
      },
    ]);

  return (
    <>
      <Row label="Value field">
        <FieldSelect
          datasetId={ds.id}
          value={r.field}
          onChange={(field) => {
            setOpen(null);
            apply({ ...buildUnique(ds, field, ramp, base) } as Renderer);
          }}
        />
      </Row>
      <Row label="Colour ramp">
        <RampPicker
          value={ramp}
          onChange={(name) => {
            const cols = rampColors(name, r.classes.length);
            apply({ ...r, ramp: name, classes: r.classes.map((c, i) => ({ ...c, symbol: recolor(c.symbol, geom, cols[i]) })) });
          }}
        />
      </Row>
      {all.total > MAX_UNIQUE_CLASSES && (
        <div className="sy-warn">{formatNumber(all.total, 0)} distinct values; only the first {MAX_UNIQUE_CLASSES} can be listed.</div>
      )}
      <div className="sy-sub">
        Classes ({r.classes.length}) <span className="grow" />
      </div>
      <div className="sy-classes">
        <div className="sy-classes-head">
          <Button variant="ghost" icon={ListPlus} onClick={addAll} disabled={!r.field} title="Add every distinct value in the data">Add all values</Button>
          <Select
            value=""
            placeholder="Add value…"
            disabled={!missing.length}
            onChange={(value) => {
              const cols = rampColors(ramp, r.classes.length + 1);
              setClasses([...r.classes, { value, label: uniqueLabel(value), symbol: recolor(base, geom, cols[cols.length - 1]) }]);
            }}
            options={missing.slice(0, MAX_UNIQUE_CLASSES).map((v) => ({ value: v.value, label: `${uniqueLabel(v.value)} (${v.count})` }))}
            style={{ width: 120 }}
          />
          <span className="grow" />
          <IconButton icon={ArrowUpDown} title="Sort / recolour" onClick={(e) => sortMenu(e.currentTarget)} />
          <IconButton icon={Trash2} title="Remove all classes" disabled={!r.classes.length} onClick={() => setClasses([])} />
        </div>
        <div className="sy-classes-list">
          {!r.classes.length && <div className="sy-note" style={{ padding: 8 }}>No classes. Use "Add all values".</div>}
          {r.classes.map((c, i) => (
            <ClassRow
              key={c.value + '\u0000' + i}
              symbol={c.symbol}
              geom={geom}
              label={c.label}
              open={open === c.value}
              off={c.visible === false}
              onToggle={() => setOpen(open === c.value ? null : c.value)}
              onLabel={(label) => setClasses(r.classes.map((x, j) => (j === i ? { ...x, label } : x)))}
              onSymbol={(symbol) => setClasses(r.classes.map((x, j) => (j === i ? { ...x, symbol } : x)))}
              leading={
                <input
                  type="checkbox"
                  className="sy-vis"
                  checked={c.visible !== false}
                  title="Draw features in this class"
                  onChange={(e) => setClasses(r.classes.map((x, j) => (j === i ? { ...x, visible: e.target.checked ? undefined : false } : x)))}
                  style={{ accentColor: 'var(--accent)', margin: 0 }}
                />
              }
              trailing={
                <>
                  <span className="sy-count" title="Features">{counts.has(c.value) ? formatNumber(counts.get(c.value)!, 0) : '0'}</span>
                  <IconButton icon={X} title="Remove class" onClick={() => setClasses(r.classes.filter((_, j) => j !== i))} />
                </>
              }
            />
          ))}
        </div>
        <div className="sy-other">
          <input
            type="checkbox"
            checked={!!r.defaultSymbol}
            title="Draw features whose value has no class"
            onChange={(e) => apply({ ...r, defaultSymbol: e.target.checked ? recolor(base, geom, '#9aa0a6') : null })}
            style={{ accentColor: 'var(--accent)', margin: 0 }}
          />
          {r.defaultSymbol ? (
            <button type="button" className={cx('sy-swatch', open === '\u0001other' && 'open')} onClick={() => setOpen(open === '\u0001other' ? null : '\u0001other')} title="Edit symbol">
              <SymbolSwatch symbol={r.defaultSymbol} geomType={geom} />
            </button>
          ) : (
            <span style={{ width: 24 }} />
          )}
          <span className="grow">&lt;all other values&gt;</span>
          <span className="sy-count">
            {formatNumber(all.values.filter((v) => !present.has(v.value)).reduce((n, v) => n + v.count, 0), 0)}
          </span>
        </div>
        {open === '\u0001other' && r.defaultSymbol && (
          <div className="sy-class-edit">
            <SymbolEditor symbol={r.defaultSymbol} geomType={geom} compact onChange={(defaultSymbol) => apply({ ...r, defaultSymbol })} />
          </div>
        )}
      </div>
    </>
  );
}

// ---------- graduated colours ----------

function Histogram({ values, classes, geom }: { values: number[]; classes: RangeClass[]; geom: GeomType | null }) {
  const bins = 36;
  const h = useMemo(() => histogram(values, bins), [values]);
  if (!h.counts.length) return null;
  const peak = Math.max(1, ...h.counts);
  const span = h.max - h.min || 1;
  const colorAt = (x: number) => {
    const c = classes.find((k) => x <= k.max) ?? classes[classes.length - 1];
    return c ? symbolColor(c.symbol, geom) : 'currentColor';
  };
  const W = 200;
  const H = 40;
  return (
    <div>
      <svg className="sy-hist" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Value distribution">
        {h.counts.map((n, i) => {
          const x0 = (i / bins) * W;
          const bh = (n / peak) * (H - 3);
          return <rect key={i} className="bar" x={x0 + 0.2} y={H - bh} width={W / bins - 0.4} height={bh} fill={colorAt(h.min + ((i + 0.5) / bins) * span)} />;
        })}
        {classes.slice(0, -1).map((c, i) => {
          const x = ((c.max - h.min) / span) * W;
          return x > 0 && x < W ? <line key={i} className="brk" x1={x} x2={x} y1={0} y2={H} /> : null;
        })}
      </svg>
      <div className="sy-hist-axis">
        <span>{formatNumber(h.min, 2)}</span>
        <span>{formatNumber(h.max, 2)}</span>
      </div>
    </div>
  );
}

export function GraduatedPanel({ ds, r, apply }: PanelProps<Extract<Renderer, { type: 'graduated' }>>) {
  const version = useDatasetVersion(ds.id);
  const geom = ds.geomType;
  const [open, setOpen] = useState<number | null>(null);
  const [count, setCount] = useState(Math.min(10, Math.max(2, r.classes.length || 5)));
  const nums = useMemo(() => (r.field ? collectNumbers(ds.features, r.field, r.normalization) : []), [ds, version, r.field, r.normalization]);
  const reversed = useMemo(() => {
    if (r.classes.length < 2) return false;
    const fwd = rampColors(r.ramp, r.classes.length);
    return symbolColor(r.classes[0].symbol, geom).toLowerCase() !== fwd[0].toLowerCase() && symbolColor(r.classes[0].symbol, geom).toLowerCase() === fwd[fwd.length - 1].toLowerCase();
  }, [r.classes, r.ramp, geom]);

  const rebuild = (patch: { field?: string; normalization?: string; method?: ClassMethod; count?: number; ramp?: string }, keepReverse = true) => {
    const field = patch.field ?? r.field;
    const norm = 'normalization' in patch ? patch.normalization : r.normalization;
    const sameData = field === r.field && norm === r.normalization;
    const method = patch.method ?? (r.method === 'manual' ? 'equal' : r.method);
    setOpen(null);
    apply(buildGraduated(ds, field, norm || undefined, method, patch.count ?? count, patch.ramp ?? r.ramp, r.base, keepReverse && reversed, sameData ? nums : undefined));
  };
  const setClass = (i: number, fn: (c: RangeClass) => RangeClass) => apply({ ...r, classes: r.classes.map((c, j) => (j === i ? fn(c) : c)) });

  return (
    <>
      <Row label="Value field"><FieldSelect datasetId={ds.id} value={r.field} types={NUMERIC} onChange={(field) => rebuild({ field })} /></Row>
      <Row label="Normalise by"><FieldSelect datasetId={ds.id} value={r.normalization ?? ''} types={NUMERIC} allowNone onChange={(normalization) => rebuild({ normalization })} /></Row>
      <Row label="Method">
        <Select
          value={r.method}
          onChange={(method) => rebuild({ method })}
          options={(Object.keys(METHOD_LABELS) as ClassMethod[]).map((m) => ({ value: m, label: METHOD_LABELS[m], disabled: m === 'manual' && r.method !== 'manual' }))}
        />
      </Row>
      <Row label="Classes">
        <Select
          value={String(count)}
          style={{ width: 70 }}
          onChange={(v) => {
            setCount(Number(v));
            rebuild({ count: Number(v), method: r.method === 'manual' ? 'equal' : r.method });
          }}
          options={Array.from({ length: 9 }, (_, i) => String(i + 2))}
        />
        <span className="muted">{r.classes.length !== count ? `(${r.classes.length} distinct)` : ''}</span>
      </Row>
      <Row label="Colour ramp">
        <RampPicker value={r.ramp} reverse={reversed} onChange={(ramp) => apply({ ...r, ramp, classes: recolorClasses(r.classes, geom, ramp, reversed) })} />
        <IconButton icon={FlipHorizontal2} title="Reverse ramp" active={reversed} onClick={() => apply({ ...r, classes: recolorClasses(r.classes, geom, r.ramp, !reversed) })} />
      </Row>
      <div className="sy-sub">Distribution <span className="grow" /></div>
      {nums.length ? <Histogram values={nums} classes={r.classes} geom={geom} /> : <div className="sy-note">No numeric values in this field.</div>}
      {nums.length < ds.features.length && nums.length > 0 && (
        <div className="sy-note">{formatNumber(ds.features.length - nums.length, 0)} features have no valid value and are not drawn.</div>
      )}
      <div className="sy-sub">Classes ({r.classes.length}) <span className="grow" /></div>
      <div className="sy-classes">
        <div className="sy-classes-head">
          <span className="grow">Symbol and label</span>
          <span style={{ width: 120 }}>Upper bound</span>
        </div>
        <div className="sy-classes-list">
          {r.classes.map((c, i) => (
            <ClassRow
              key={i}
              symbol={c.symbol}
              geom={geom}
              label={c.label}
              open={open === i}
              onToggle={() => setOpen(open === i ? null : i)}
              onLabel={(label) => setClass(i, (x) => ({ ...x, label }))}
              onSymbol={(symbol) => setClass(i, (x) => ({ ...x, symbol }))}
              trailing={
                <span className="sy-bound">
                  &le;
                  <CommitNumber
                    value={c.max}
                    title={`Upper bound of class ${i + 1} (editing switches to Manual)`}
                    onCommit={(v) => apply({ ...r, method: 'manual', classes: setUpperBound(r.classes, i, v) })}
                  />
                </span>
              }
            />
          ))}
        </div>
      </div>
      <div className="hstack" style={{ marginTop: 6 }}>
        <Button variant="ghost" icon={RotateCcw} onClick={() => rebuild({}, true)} title="Recompute class breaks with the current method">Recompute</Button>
        <Button variant="ghost" onClick={() => apply({ ...r, classes: relabel(r.classes) })} title="Regenerate legend labels from the bounds">Reset labels</Button>
      </div>
      <div className="sy-sub">Base symbol <span className="grow" /></div>
      <SymbolEditor
        symbol={r.base}
        geomType={geom}
        compact
        onChange={(base) => {
          // Keep each class's colour; apply the other properties (outline, size, shape...) to every class.
          apply({ ...r, base, classes: r.classes.map((c) => ({ ...c, symbol: recolor({ ...base }, geom, symbolColor(c.symbol, geom)) })) });
        }}
      />
    </>
  );
}

// ---------- graduated symbols ----------

export function ProportionalPanel({ ds, r, apply }: PanelProps<Extract<Renderer, { type: 'proportional' }>>) {
  const version = useDatasetVersion(ds.id);
  const geom = ds.geomType;
  const nums = useMemo(() => (r.field ? collectNumbers(ds.features, r.field) : []), [ds, version, r.field]);
  const line = geom === 'LineString';
  const unit = line ? 'width' : 'radius';
  const sw = (size: number): SymbolDef => (line ? { ...r.symbol, strokeWidth: size } : { ...r.symbol, size });
  return (
    <>
      <Row label="Value field">
        <FieldSelect
          datasetId={ds.id}
          value={r.field}
          types={NUMERIC}
          onChange={(field) => {
            const next = buildProportional(ds, field, r.symbol, { minSize: r.minSize, maxSize: r.maxSize });
            apply(next);
          }}
        />
      </Row>
      <Row label={`Min ${unit} (px)`}><CommitNumber value={r.minSize} min={0.5} max={100} step={0.5} onCommit={(minSize) => apply({ ...r, minSize, maxSize: Math.max(r.maxSize, minSize) })} /></Row>
      <Row label={`Max ${unit} (px)`}><CommitNumber value={r.maxSize} min={0.5} max={200} step={0.5} onCommit={(maxSize) => apply({ ...r, maxSize, minSize: Math.min(r.minSize, maxSize) })} /></Row>
      <Row label="Value range">
        <CommitNumber value={r.minValue} onCommit={(minValue) => apply({ ...r, minValue })} />
        <span className="muted">to</span>
        <CommitNumber value={r.maxValue} onCommit={(maxValue) => apply({ ...r, maxValue })} />
        <IconButton icon={RotateCcw} title="Reset to the data range" onClick={() => { const d = dataRange(nums); apply({ ...r, minValue: d.min, maxValue: d.max }); }} />
      </Row>
      <div className="sy-note">Sizes scale with the square root of the value so symbol area tracks the data.</div>
      <div className="sy-legend-prev">
        <span className="it"><SymbolSwatch symbol={sw(r.minSize)} geomType={geom} width={34} height={28} />{formatNumber(r.minValue, 2)}</span>
        <span className="it"><SymbolSwatch symbol={sw(r.maxSize)} geomType={geom} width={34} height={28} />{formatNumber(r.maxValue, 2)}</span>
      </div>
      <div className="sy-sub">Symbol <span className="grow" /></div>
      <SymbolEditor symbol={r.symbol} geomType={geom} compact hideSize onChange={(symbol) => apply({ ...r, symbol })} />
    </>
  );
}

// ---------- heat map ----------

/** Local state with a debounced commit, so dragging a slider does not rebuild the heat layer on every tick. */
function useDebouncedCommit<T>(value: T, commit: (v: T) => void, ms = 120): [T, (v: T) => void] {
  const [local, setLocal] = useState(value);
  const timer = useRef<any>(null);
  const latest = useRef(commit);
  latest.current = commit;
  useEffect(() => setLocal(value), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [
    local,
    (v: T) => {
      setLocal(v);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => latest.current(v), ms);
    },
  ];
}

export function HeatmapPanel({ ds, r, apply }: PanelProps<Extract<Renderer, { type: 'heatmap' }>>) {
  const [radius, setRadius] = useDebouncedCommit(r.radius, (v) => apply({ ...r, radius: v }));
  const [blur, setBlur] = useDebouncedCommit(r.blur, (v) => apply({ ...r, blur: v }));
  return (
    <>
      <Row label="Weight field"><FieldSelect datasetId={ds.id} value={r.field ?? ''} types={NUMERIC} allowNone onChange={(field) => apply({ ...r, field: field || undefined })} /></Row>
      <Row label="Radius"><Slider value={radius} min={1} max={60} step={1} onChange={setRadius} format={(v) => `${v}px`} /></Row>
      <Row label="Blur"><Slider value={blur} min={1} max={60} step={1} onChange={setBlur} format={(v) => `${v}px`} /></Row>
      <Row label="Colour ramp"><RampPicker value={r.ramp} kinds={['sequential']} onChange={(ramp) => apply({ ...r, ramp })} /></Row>
      <div className="sy-note">Without a weight field every feature counts equally. Stops run from low density (left) to high density (right).</div>
    </>
  );
}
