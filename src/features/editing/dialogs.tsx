// Editing dialogs: New Empty Layer, Paste Special, Merge, Buffer, Rotate / Scale.
import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Field, FieldType, GeomType, Id } from '../../core/types';
import { createDataset, featureById } from '../../core/data';
import { addDatasetLayer, findFeatureLayer } from '../../core/store';
import { notify, setActiveLayer, setTool, useActiveMapId } from '../../core/ui';
import { Button, Checkbox, IconButton, NumberInput, Row, Select, TextInput, cx, useFeatureLayers } from '../../ui/kit';
import { SymbolSwatch, legendFor } from '../symbology/legend';
import { mergeGeometries, type BufferUnits } from './geom';
import { bufferSelected, mergeFeatures, paste, rotateSelected, scaleSelected, type PivotMode } from './ops';
import { setTemplate, useEdit } from './state';
import { displayName, familyLabel, resolveSelection, templatesFor } from './util';

type DialogProps<P = any> = { props: P; close: () => void };

const FIELD_TYPES: Array<{ value: FieldType; label: string }> = [
  { value: 'string', label: 'Text' },
  { value: 'integer', label: 'Integer' },
  { value: 'number', label: 'Double' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Boolean' },
];
const IDENT = /^[A-Za-z_][A-Za-z0-9_ ]{0,62}$/;

// ---------- New empty layer ----------

export function NewLayerDialog({ close }: DialogProps) {
  const mapId = useActiveMapId();
  const [name, setName] = useState('New Layer');
  const [geom, setGeom] = useState<GeomType>('Polygon');
  const [fields, setFields] = useState<Field[]>([{ name: 'Name', type: 'string' }]);
  const [start, setStart] = useState(true);

  const problems = useMemo(() => {
    const out: string[] = [];
    if (!name.trim()) out.push('Enter a layer name.');
    const seen = new Set<string>();
    for (const f of fields) {
      const n = f.name.trim();
      if (!IDENT.test(n)) out.push(`"${n || '(empty)'}" is not a valid field name (letters, digits, _ and spaces; must not start with a digit).`);
      else if (seen.has(n.toLowerCase())) out.push(`Field "${n}" is listed twice.`);
      seen.add(n.toLowerCase());
    }
    return out;
  }, [name, fields]);

  const patch = (i: number, p: Partial<Field>) => setFields(fields.map((f, k) => (k === i ? { ...f, ...p } : f)));

  const create = () => {
    if (!mapId) return notify('Open a map first.', 'warning');
    if (problems.length) return;
    const ds = createDataset({ name: name.trim(), features: [], fields: fields.map((f) => ({ ...f, name: f.name.trim() })), geomType: geom, source: 'New empty layer' });
    const layer = addDatasetLayer(mapId, ds);
    setActiveLayer(layer.id);
    if (start) {
      setTemplate(templatesFor(layer, ds)[0], geom);
      setTool('edit-create');
    }
    notify(`Created empty ${familyLabel(geom)} layer "${ds.name}".`, 'success');
    close();
  };

  return (
    <>
      <div className="dialog-body">
        <Row label="Name">
          <TextInput value={name} onChange={setName} autoFocus />
        </Row>
        <Row label="Geometry type">
          <Select<GeomType>
            value={geom}
            onChange={setGeom}
            options={[{ value: 'Point', label: 'Point' }, { value: 'LineString', label: 'Line' }, { value: 'Polygon', label: 'Polygon' }]}
          />
        </Row>
        <div className="editing-fields">
          <div className="editing-fields-head">
            <span>Fields</span>
            <Button variant="ghost" icon={Plus} onClick={() => setFields([...fields, { name: `Field${fields.length + 1}`, type: 'string' }])}>
              Add field
            </Button>
          </div>
          {fields.length === 0 && <div className="muted editing-pad">No fields. Features will only have geometry and an FID.</div>}
          {fields.map((f, i) => (
            <div className="editing-field-row" key={i}>
              <TextInput value={f.name} onChange={(v) => patch(i, { name: v })} invalid={!IDENT.test(f.name.trim())} />
              <Select<FieldType> value={f.type} onChange={(v) => patch(i, { type: v })} options={FIELD_TYPES} style={{ width: 96, flex: 'none' }} />
              <IconButton icon={Trash2} title="Remove field" onClick={() => setFields(fields.filter((_, k) => k !== i))} />
            </div>
          ))}
        </div>
        {problems.length > 0 && <div className="error-text editing-pad">{problems[0]}</div>}
        <Checkbox checked={start} onChange={setStart} label="Start creating features in the new layer" />
      </div>
      <div className="dialog-footer">
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!!problems.length || !mapId} onClick={create}>
          Create
        </Button>
      </div>
    </>
  );
}

// ---------- Paste special ----------

export function PasteSpecialDialog({ close }: DialogProps) {
  const clip = useEdit((s) => s.clipboard);
  const layers = useFeatureLayers().filter((x) => x.layer.editable && x.dataset.geomType === clip?.family);
  const [target, setTarget] = useState<Id | null>(layers[0]?.layer.id ?? null);
  const [attrs, setAttrs] = useState(true);
  if (!clip) {
    return (
      <>
        <div className="dialog-body muted">The clipboard is empty. Copy features first.</div>
        <div className="dialog-footer">
          <Button onClick={close}>Close</Button>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="dialog-body">
        <div className="muted editing-pad">
          {clip.items.length} {familyLabel(clip.family)} feature{clip.items.length === 1 ? '' : 's'} on the clipboard. Paste into:
        </div>
        <div className="editing-list">
          {layers.length === 0 && <div className="muted editing-pad">No editable {familyLabel(clip.family)} layers in this map.</div>}
          {layers.map(({ layer, dataset }) => (
            <label key={layer.id} className={cx('editing-list-item', target === layer.id && 'selected')}>
              <input type="radio" checked={target === layer.id} onChange={() => setTarget(layer.id)} />
              <SymbolSwatch symbol={legendFor(layer, dataset).items[0]?.symbol ?? { fill: '#888', fillOpacity: 1, stroke: '#444', strokeWidth: 1, size: 5, shape: 'circle' }} geomType={dataset.geomType} />
              <span className="grow">{layer.name}</span>
            </label>
          ))}
        </div>
        <Checkbox checked={attrs} onChange={setAttrs} label="Keep attribute values of matching fields" />
      </div>
      <div className="dialog-footer">
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!target}
          onClick={() => {
            if (target) paste(target, { attributes: attrs });
            close();
          }}
        >
          Paste
        </Button>
      </div>
    </>
  );
}

// ---------- Merge ----------

export function MergeDialog({ props, close }: DialogProps<{ layerId: Id; fids: number[] }>) {
  const ref = findFeatureLayer(props.layerId);
  const feats = ref ? props.fids.map((id) => featureById(ref.dataset.id, id)).filter(Boolean) : [];
  const [survivor, setSurvivor] = useState<number>(props.fids[0]);
  const preview = useMemo(() => {
    try {
      return mergeGeometries(feats.map((f) => f!.geometry))?.type ?? 'empty';
    } catch (err: any) {
      return `error: ${err?.message ?? err}`;
    }
  }, [props.fids.join(',')]);
  if (!ref) return null;
  return (
    <>
      <div className="dialog-body">
        <div className="muted editing-pad">
          Merge {feats.length} features of "{ref.layer.name}" into one {preview}. Choose the feature whose attributes are kept:
        </div>
        <div className="editing-list">
          {feats.map((f) => (
            <label key={f!.id} className={cx('editing-list-item', survivor === f!.id && 'selected')}>
              <input type="radio" checked={survivor === f!.id} onChange={() => setSurvivor(f!.id)} />
              <span className="grow">{displayName(ref.dataset, f!)}</span>
              <span className="muted">FID {f!.id}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="dialog-footer">
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="primary"
          disabled={preview.startsWith('error')}
          onClick={() => {
            mergeFeatures(props.layerId, props.fids, survivor);
            close();
          }}
        >
          Merge
        </Button>
      </div>
    </>
  );
}

// ---------- Buffer ----------

const UNITS: Array<{ value: BufferUnits; label: string }> = [
  { value: 'meters', label: 'Meters' },
  { value: 'kilometers', label: 'Kilometers' },
  { value: 'feet', label: 'Feet' },
  { value: 'miles', label: 'Miles' },
  { value: 'nauticalmiles', label: 'Nautical miles' },
];

export function BufferDialog({ close }: DialogProps) {
  const polyLayers = useFeatureLayers().filter((x) => x.layer.editable && x.dataset.geomType === 'Polygon');
  const sel = useMemo(() => resolveSelection().groups, []);
  const allPolygons = sel.length > 0 && sel.every((g) => g.dataset.geomType === 'Polygon');
  const [distance, setDistance] = useState(100);
  const [units, setUnits] = useState<BufferUnits>('meters');
  const [mode, setMode] = useState<'replace' | 'layer'>(allPolygons ? 'replace' : 'layer');
  const [layerId, setLayerId] = useState<Id | null>(polyLayers[0]?.layer.id ?? null);
  const count = sel.reduce((n, g) => n + g.feats.length, 0);
  const ok = distance !== 0 && (mode === 'replace' ? allPolygons : !!layerId);
  return (
    <>
      <div className="dialog-body">
        <div className="muted editing-pad">Buffer {count} selected feature{count === 1 ? '' : 's'} (geodesic distance; negative values shrink polygons).</div>
        <Row label="Distance">
          <NumberInput value={distance} onChange={setDistance} step={10} />
          <Select<BufferUnits> value={units} onChange={setUnits} options={UNITS} style={{ width: 130, flex: 'none' }} />
        </Row>
        <Row label="Result">
          <div className="vstack">
            <label className="check">
              <input type="radio" checked={mode === 'replace'} disabled={!allPolygons} onChange={() => setMode('replace')} />
              Replace the selected polygons
            </label>
            <label className="check">
              <input type="radio" checked={mode === 'layer'} onChange={() => setMode('layer')} />
              Add buffered copies to a polygon layer
            </label>
          </div>
        </Row>
        {mode === 'layer' && (
          <Row label="Target layer" hint={polyLayers.length ? undefined : 'No editable polygon layer in this map. Create one with Edit > New Layer.'}>
            <Select value={layerId ?? ''} onChange={setLayerId} placeholder="Select a polygon layer…" options={polyLayers.map((x) => ({ value: x.layer.id, label: x.layer.name }))} />
          </Row>
        )}
      </div>
      <div className="dialog-footer">
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!ok || !count}
          onClick={() => {
            bufferSelected(distance, units, mode === 'replace' ? { mode: 'replace' } : { mode: 'layer', layerId: layerId! });
            close();
          }}
        >
          Buffer
        </Button>
      </div>
    </>
  );
}

// ---------- Rotate / Scale ----------

export function TransformDialog({ props, close }: DialogProps<{ kind: 'rotate' | 'scale' }>) {
  const rotate = props.kind === 'rotate';
  const [value, setValue] = useState(rotate ? 90 : 2);
  const [pivot, setPivot] = useState<PivotMode>('each');
  const presets = rotate ? [-90, 45, 90, 180] : [0.5, 2, 10];
  const valid = rotate ? Number.isFinite(value) && value !== 0 : value > 0 && value !== 1;
  const apply = () => {
    if (rotate) rotateSelected(value, pivot);
    else scaleSelected(value, pivot);
    close();
  };
  return (
    <>
      <div className="dialog-body">
        <Row label={rotate ? 'Angle (°, clockwise)' : 'Scale factor'}>
          <NumberInput value={value} onChange={setValue} step={rotate ? 15 : 0.1} min={rotate ? -360 : 0.0001} max={rotate ? 360 : undefined} />
          <div className="hstack editing-presets">
            {presets.map((p) => (
              <Button key={p} variant="ghost" className={cx(value === p && 'editing-on')} onClick={() => setValue(p)}>
                {rotate ? `${p}°` : `×${p}`}
              </Button>
            ))}
          </div>
        </Row>
        <Row label="About">
          <Select<PivotMode>
            value={pivot}
            onChange={setPivot}
            options={[{ value: 'each', label: "Each feature's centre" }, { value: 'selection', label: 'Centre of the whole selection' }]}
          />
        </Row>
      </div>
      <div className="dialog-footer">
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!valid} onClick={apply}>
          {rotate ? 'Rotate' : 'Scale'}
        </Button>
      </div>
    </>
  );
}
