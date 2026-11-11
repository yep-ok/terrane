// Attributes pane: selected features grouped by layer, an editable attribute grid
// for one feature (or shared values of all selected features of a layer) and a
// geometry summary.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ClipboardList, Eraser, Lock, RotateCcw, ZoomIn } from 'lucide-react';
import type { Dataset, Feat, Field, Id } from '../../core/types';
import { applyEdits, coerce, featureById, useDataset, useDatasetVersion } from '../../core/data';
import { useMapDoc } from '../../core/store';
import { clearSelection, useActiveMapId, useUi } from '../../core/ui';
import { getMapHandle } from '../../map/handle';
import { Button, Checkbox, Empty, IconButton, cx, formatNumber } from '../../ui/kit';
import { geometrySummary, type GeometrySummary } from './geom';
import { useEdit } from './state';
import { displayName } from './util';

const VARIES = Symbol('varies');
const MAX_TREE = 400;

interface Focus {
  layerId: Id;
  /** null = every selected feature of the layer. */
  fid: number | null;
}

export function formatLength(m: number) {
  return m >= 1000 ? `${formatNumber(m / 1000, 3)} km` : `${formatNumber(m, 2)} m`;
}
export function formatArea(m2: number) {
  if (m2 >= 1e6) return `${formatNumber(m2 / 1e6, 3)} km²`;
  if (m2 >= 1e4) return `${formatNumber(m2 / 1e4, 2)} ha`;
  return `${formatNumber(m2, 1)} m²`;
}

function useSelectedLayers() {
  const mapId = useActiveMapId();
  const doc = useMapDoc(mapId);
  const selection = useUi((s) => s.selection);
  return useMemo(() => {
    const out: Array<{ layerId: Id; name: string; datasetId: Id; editable: boolean; fids: number[] }> = [];
    for (const l of doc?.layers ?? []) {
      if (l.kind !== 'feature' || !selection[l.id]?.length) continue;
      out.push({ layerId: l.id, name: l.name, datasetId: l.datasetId, editable: l.editable, fids: selection[l.id] });
    }
    return out;
  }, [doc, selection]);
}

export function AttributesPane() {
  const layers = useSelectedLayers();
  const [focus, setFocus] = useState<Focus | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const autoApply = useEdit((s) => s.autoApply);

  // Keep focus valid as the selection changes.
  const valid = focus && layers.find((l) => l.layerId === focus.layerId && (focus.fid === null || l.fids.includes(focus.fid)));
  const eff: Focus | null = valid
    ? focus
    : layers.length
      ? { layerId: layers[0].layerId, fid: layers[0].fids.length === 1 ? layers[0].fids[0] : null }
      : null;

  if (!layers.length)
    return (
      <Empty icon={ClipboardList} title="No features selected">
        Select features on the map to view and edit their attributes.
      </Empty>
    );

  const total = layers.reduce((n, l) => n + l.fids.length, 0);
  const flash = (datasetId: Id, fids: number[]) => getMapHandle()?.flash(fids.map((id) => featureById(datasetId, id)?.geometry));

  return (
    <>
      <div className="pane-toolbar">
        <span className="muted grow">{total} selected</span>
        <Checkbox checked={autoApply} onChange={(v) => useEdit.setState({ autoApply: v })} label="Auto apply" title="Commit each change immediately" />
        <IconButton icon={ZoomIn} title="Zoom to selection" onClick={() => getMapHandle()?.zoomToSelection()} />
        <IconButton icon={Eraser} title="Clear selection" onClick={() => clearSelection()} />
      </div>
      <div className="editing-attr-tree">
        {layers.map((l) => (
          <TreeLayer
            key={l.layerId}
            layer={l}
            focus={eff}
            closed={!!collapsed[l.layerId]}
            onToggle={() => setCollapsed({ ...collapsed, [l.layerId]: !collapsed[l.layerId] })}
            onFocus={(f) => {
              setFocus(f);
              flash(l.datasetId, f.fid === null ? l.fids : [f.fid]);
            }}
          />
        ))}
      </div>
      {eff && (
        <AttributeGrid
          key={`${eff.layerId}:${eff.fid ?? 'all'}`}
          layer={layers.find((l) => l.layerId === eff.layerId)!}
          fids={eff.fid === null ? layers.find((l) => l.layerId === eff.layerId)!.fids : [eff.fid]}
        />
      )}
    </>
  );
}

function TreeLayer({
  layer, focus, closed, onToggle, onFocus,
}: {
  layer: { layerId: Id; name: string; datasetId: Id; editable: boolean; fids: number[] };
  focus: Focus | null;
  closed: boolean;
  onToggle: () => void;
  onFocus: (f: Focus) => void;
}) {
  const ds = useDataset(layer.datasetId);
  if (!ds) return null;
  const shown = layer.fids.slice(0, MAX_TREE);
  const headSel = focus?.layerId === layer.layerId && focus.fid === null;
  return (
    <div>
      <div className={cx('editing-tree-row head', headSel && 'selected')} onClick={() => onFocus({ layerId: layer.layerId, fid: null })}>
        <span className="editing-twisty" onClick={(e) => (e.stopPropagation(), onToggle())}>
          {closed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </span>
        <span className="grow editing-ellipsis">{layer.name}</span>
        {!layer.editable && <Lock size={11} className="muted" />}
        <span className="editing-count">{layer.fids.length}</span>
      </div>
      {!closed &&
        shown.map((fid) => {
          const f = featureById(ds.id, fid);
          if (!f) return null;
          return (
            <div
              key={fid}
              className={cx('editing-tree-row', focus?.layerId === layer.layerId && focus.fid === fid && 'selected')}
              onClick={() => onFocus({ layerId: layer.layerId, fid })}
              onDoubleClick={() => getMapHandle()?.zoomToFeatures(layer.layerId, [fid])}
              title="Click to flash · Double-click to zoom"
            >
              <span className="editing-ellipsis grow">{displayName(ds, f)}</span>
            </div>
          );
        })}
      {!closed && layer.fids.length > MAX_TREE && <div className="editing-tree-row muted">… {layer.fids.length - MAX_TREE} more</div>}
    </div>
  );
}

// ---------- grid ----------

function sharedValue(feats: Feat[], field: string): any {
  if (!feats.length) return null;
  const first = feats[0].properties[field] ?? null;
  for (const f of feats) if ((f.properties[field] ?? null) !== first) return VARIES;
  return first;
}

function AttributeGrid({ layer, fids }: { layer: { layerId: Id; name: string; datasetId: Id; editable: boolean }; fids: number[] }) {
  const ds = useDataset(layer.datasetId);
  const autoApply = useEdit((s) => s.autoApply);
  const [draft, setDraft] = useState<Record<string, any>>({});
  if (!ds) return null;
  const feats = fids.map((id) => featureById(ds.id, id)).filter(Boolean) as Feat[];
  const readOnly = !layer.editable;
  const dirty = Object.keys(draft).length > 0;

  const commit = (values: Record<string, any>) => {
    const keys = Object.keys(values);
    if (!keys.length || readOnly) return;
    const props: Record<string, any> = {};
    for (const k of keys) {
      const field = ds.fields.find((f) => f.name === k);
      if (field) props[k] = coerce(values[k], field.type);
    }
    const updates = feats.filter((f) => keys.some((k) => (f.properties[k] ?? null) !== props[k])).map((f) => ({ id: f.id, properties: props }));
    if (updates.length)
      applyEdits(ds.id, { updates }, { label: keys.length === 1 ? `Edit ${keys[0]}` : `Edit ${keys.length} attributes` });
    setDraft({});
  };

  const change = (field: string, value: any, final: boolean) => {
    if (autoApply && final) commit({ [field]: value });
    else setDraft((d) => ({ ...d, [field]: value }));
  };

  return (
    <>
      <div className="pane-body">
        {readOnly && (
          <div className="editing-note">
            <Lock size={12} /> "{layer.name}" is not editable. Values are read-only.
          </div>
        )}
        <div className="editing-grid">
          <div className="editing-grid-label">FID</div>
          <div className="editing-grid-value muted">{feats.length === 1 ? feats[0].id : `${feats.length} features`}</div>
          {ds.fields.map((f) => {
            const base = sharedValue(feats, f.name);
            const value = f.name in draft ? draft[f.name] : base;
            return (
              <FieldRow key={f.name} field={f} value={value} edited={f.name in draft} disabled={readOnly} onChange={(v, final) => change(f.name, v, final)} />
            );
          })}
        </div>
        {ds.fields.length === 0 && <div className="muted editing-pad">This layer has no attribute fields.</div>}
        <GeometryBlock ds={ds} feats={feats} />
      </div>
      {!readOnly && !autoApply && (
        <div className="pane-footer">
          <Button icon={RotateCcw} disabled={!dirty} onClick={() => setDraft({})}>
            Reset
          </Button>
          <Button variant="primary" disabled={!dirty} onClick={() => commit(draft)}>
            Apply{feats.length > 1 ? ` to ${feats.length}` : ''}
          </Button>
        </div>
      )}
    </>
  );
}

function toDateInput(v: any): string {
  if (v === null || v === undefined || v === VARIES) return '';
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

function FieldRow({ field, value, edited, disabled, onChange }: { field: Field; value: any; edited: boolean; disabled: boolean; onChange: (v: any, final: boolean) => void }) {
  const varies = value === VARIES;
  const label = (
    <div className={cx('editing-grid-label', edited && 'edited')} title={`${field.name} (${field.type})`}>
      {field.alias || field.name}
    </div>
  );
  let input;
  if (field.type === 'boolean') {
    input = <BoolInput value={varies ? null : value} indeterminate={varies} disabled={disabled} onChange={(v) => onChange(v, true)} />;
  } else if (field.type === 'date') {
    input = (
      <input
        type="date"
        className="input"
        disabled={disabled}
        value={toDateInput(value)}
        placeholder={varies ? '<varies>' : ''}
        onChange={(e) => onChange(e.target.value || null, true)}
      />
    );
  } else {
    const numeric = field.type === 'number' || field.type === 'integer';
    input = (
      <DraftInput
        numeric={numeric}
        step={field.type === 'integer' ? 1 : 'any'}
        disabled={disabled}
        value={varies || value === null || value === undefined ? '' : String(value)}
        placeholder={varies ? '<varies>' : '<null>'}
        onDraft={(t) => onChange(t === '' ? null : t, false)}
        onCommit={(t) => onChange(t === '' ? null : t, true)}
      />
    );
  }
  return (
    <>
      {label}
      <div className="editing-grid-value">{input}</div>
    </>
  );
}

function DraftInput({
  value, numeric, step, disabled, placeholder, onDraft, onCommit,
}: { value: string; numeric: boolean; step: number | 'any'; disabled: boolean; placeholder: string; onDraft: (t: string) => void; onCommit: (t: string) => void }) {
  const [text, setText] = useState(value);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setText(value);
  }, [value, dirty]);
  return (
    <input
      type={numeric ? 'number' : 'text'}
      step={numeric ? step : undefined}
      className="input"
      disabled={disabled}
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => {
        setText(e.target.value);
        setDirty(true);
        onDraft(e.target.value);
      }}
      onBlur={() => {
        if (dirty) onCommit(text);
        setDirty(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onCommit(text);
          setDirty(false);
        } else if (e.key === 'Escape') {
          setText(value);
          setDirty(false);
        }
      }}
    />
  );
}

function BoolInput({ value, indeterminate, disabled, onChange }: { value: any; indeterminate: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className="check">
      <input ref={ref} type="checkbox" disabled={disabled} checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      <span className="muted">{indeterminate ? '<varies>' : value === null || value === undefined ? '<null>' : value ? 'True' : 'False'}</span>
    </label>
  );
}

// ---------- geometry ----------

function GeometryBlock({ ds, feats }: { ds: Dataset; feats: Feat[] }) {
  const version = useDatasetVersion(ds.id);
  const key = feats.map((f) => f.id).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sums = useMemo(() => feats.map((f) => geometrySummary(f.geometry)).filter(Boolean) as GeometrySummary[], [version, key]);
  if (!sums.length) return null;
  const add = (k: 'length' | 'area' | 'perimeter' | 'vertices' | 'parts') => sums.reduce((n, s) => n + (s[k] ?? 0), 0);
  const one = sums.length === 1 ? sums[0] : null;
  const rows: Array<[string, string]> = [];
  rows.push(['Type', one ? one.type : `${sums.length} × ${ds.geomType === 'LineString' ? 'Line' : ds.geomType}`]);
  rows.push(['Parts', String(add('parts'))]);
  rows.push(['Vertices', add('vertices').toLocaleString()]);
  if (ds.geomType === 'LineString') rows.push([one ? 'Length' : 'Total length', formatLength(add('length'))]);
  if (ds.geomType === 'Polygon') {
    rows.push([one ? 'Area' : 'Total area', formatArea(add('area'))]);
    rows.push([one ? 'Perimeter' : 'Total perimeter', formatLength(add('perimeter'))]);
  }
  if (one?.point) rows.push(['Location', `${one.point[1].toFixed(6)}, ${one.point[0].toFixed(6)}`]);
  return (
    <div className="editing-geom">
      <div className="editing-geom-title">Geometry (geodesic)</div>
      <div className="editing-grid">
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <div className="editing-grid-label">{k}</div>
            <div className="editing-grid-value selectable editing-mono">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
