// Select By Location dialog + command.
import { useState } from 'react';
import { MapPinned } from 'lucide-react';
import type { Id } from '../../core/types';
import { findFeatureLayer } from '../../core/store';
import { getSelection, notify, openDialog, setBusy, setSelection, useSelection, useUi } from '../../core/ui';
import { registerCommand, registerDialog } from '../../core/registry';
import { Button, Checkbox, LayerSelect, NumberInput, Row, Select, useFeatureLayers } from '../../ui/kit';
import { RELATIONS, matchByLocation, type Relation } from './spatial';
import { DISTANCE_UNITS, toMetres, type DistanceUnit } from './units';
import { layerFeatures, needHandle } from './util';

type SelType = 'new' | 'add' | 'remove' | 'subset';
const SEL_TYPES: Array<{ value: SelType; label: string }> = [
  { value: 'new', label: 'New selection' },
  { value: 'add', label: 'Add to the current selection' },
  { value: 'remove', label: 'Remove from the current selection' },
  { value: 'subset', label: 'Select from the current selection' },
];

interface Params {
  targets: Id[];
  source: Id;
  onlySelected: boolean;
  relation: Relation;
  distance: number;
  unit: DistanceUnit;
  selType: SelType;
}

async function run(p: Params) {
  const src = findFeatureLayer(p.source);
  if (!src) return notify('Choose a layer to select with', 'warning');
  let sources = layerFeatures(src.layer, src.dataset);
  if (p.onlySelected) {
    const sel = new Set(getSelection(p.source));
    if (!sel.size) return notify(`"${src.layer.name}" has no selected features`, 'warning');
    sources = sources.filter((f) => sel.has(f.id));
  }
  const distanceM = p.relation === 'distance' ? toMetres(p.distance, p.unit) : 0;
  setBusy('Selecting by location…');
  try {
    let total = 0;
    for (const id of p.targets) {
      const t = findFeatureLayer(id);
      if (!t) continue;
      setBusy(`Selecting by location – ${t.layer.name}…`);
      const ids = await matchByLocation(layerFeatures(t.layer, t.dataset), sources, { relation: p.relation, distanceM });
      if (p.selType === 'subset') {
        const cur = new Set(getSelection(id));
        setSelection(id, ids.filter((i) => cur.has(i)), 'new');
        total += ids.filter((i) => cur.has(i)).length;
      } else {
        setSelection(id, ids, p.selType);
        total += ids.length;
      }
    }
    const n = p.targets.length;
    notify(`${total.toLocaleString()} feature${total === 1 ? '' : 's'} matched in ${n} layer${n === 1 ? '' : 's'}`, total ? 'success' : 'info');
  } catch (err: any) {
    notify(`Select By Location failed: ${err?.message ?? err}`, 'error');
  } finally {
    setBusy(null);
  }
}

function ByLocationDialog({ props, close }: { props: { mapId: string }; close: () => void }) {
  const layers = useFeatureLayers(props.mapId);
  const activeLayerId = useUi((s) => s.activeLayerId);
  const [targets, setTargets] = useState<Id[]>(() => (layers.some((l) => l.layer.id === activeLayerId) ? [activeLayerId!] : layers[0] ? [layers[0].layer.id] : []));
  const [source, setSource] = useState<Id | null>(() => layers.find((l) => l.layer.id !== (activeLayerId ?? layers[0]?.layer.id))?.layer.id ?? layers[0]?.layer.id ?? null);
  const [onlySelected, setOnlySelected] = useState(false);
  const [relation, setRelation] = useState<Relation>('intersect');
  const [distance, setDistance] = useState(100);
  const [unit, setUnit] = useState<DistanceUnit>('m');
  const [selType, setSelType] = useState<SelType>('new');
  const nSel = useSelection(source).length;

  const toggle = (id: Id) => setTargets((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const ready = targets.length > 0 && !!source && (relation !== 'distance' || distance >= 0);

  if (!layers.length) {
    return (
      <>
        <div className="dialog-body muted">Add a feature layer to the map to select by location.</div>
        <div className="dialog-footer"><Button onClick={close}>Close</Button></div>
      </>
    );
  }
  return (
    <>
      <div className="dialog-body">
        <Row label="Input layers" stacked hint="Features in these layers are selected.">
          <div className="nav-checklist">
            {layers.map((l) => (
              <Checkbox key={l.layer.id} checked={targets.includes(l.layer.id)} onChange={() => toggle(l.layer.id)} label={l.layer.name} />
            ))}
          </div>
        </Row>
        <Row label="Relationship">
          <Select<Relation> value={relation} onChange={setRelation} options={RELATIONS} />
        </Row>
        {relation === 'distance' && (
          <Row label="Search distance">
            <NumberInput value={distance} onChange={setDistance} min={0} style={{ width: 110 }} />
            <Select<DistanceUnit> value={unit} onChange={setUnit} options={DISTANCE_UNITS.map((u) => ({ value: u.value, label: u.label }))} />
          </Row>
        )}
        <Row label="Selecting layer">
          <LayerSelect value={source} onChange={setSource} mapId={props.mapId} />
        </Row>
        <Row label=" ">
          <Checkbox checked={onlySelected} onChange={setOnlySelected} label={`Use only the selected features${nSel ? ` (${nSel.toLocaleString()})` : ''}`} />
        </Row>
        <Row label="Selection type">
          <Select<SelType> value={selType} onChange={setSelType} options={SEL_TYPES} />
        </Row>
      </div>
      <div className="dialog-footer">
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="primary"
          icon={MapPinned}
          disabled={!ready}
          onClick={() => {
            close();
            void run({ targets, source: source!, onlySelected, relation, distance, unit, selType });
          }}
        >
          Run
        </Button>
      </div>
    </>
  );
}

export function registerByLocation() {
  registerDialog({ id: 'nav-bylocation', title: 'Select By Location', width: 480, component: ByLocationDialog });
  registerCommand({
    id: 'select.byLocation', title: 'Select By Location', icon: MapPinned,
    description: 'Select features by their spatial relationship to another layer', keywords: 'intersect within distance spatial',
    enabled: () => !!useUi.getState().activeMapId,
    run: () => {
      const h = needHandle();
      if (h) openDialog('nav-bylocation', { mapId: h.mapId });
    },
  });
}
