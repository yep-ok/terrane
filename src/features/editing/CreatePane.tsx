// Create Features pane: feature templates of the active map's editable layers and
// the construction tools valid for the chosen template's geometry.
import { useState } from 'react';
import {
  Brush, ChevronDown, ChevronRight, Circle, Hexagon, Lock, LockOpen, Magnet, MapPin, PenTool, Pencil, Pentagon, Plus,
  RectangleHorizontal, Search, Spline, type LucideIcon,
} from 'lucide-react';
import type { SymbolDef } from '../../core/types';
import { updateLayer } from '../../core/store';
import { openDialog, setTool, useActiveMapId, useActiveTool } from '../../core/ui';
import { Empty, IconButton, NumberInput, TextInput, cx, useFeatureLayers } from '../../ui/kit';
import { SymbolSwatch, legendFor } from '../symbology/legend';
import type { Family } from './geom';
import { CONSTRUCTIONS, CONSTRUCTION_LABEL, setConstruction, setTemplate, useEdit, type Construction, type Template } from './state';
import { familyLabel, templatesFor } from './util';

const CONSTRUCTION_ICON: Record<Construction, LucideIcon> = {
  point: MapPin,
  line: Spline,
  'freehand-line': Pencil,
  polygon: Pentagon,
  'freehand-polygon': Brush,
  rectangle: RectangleHorizontal,
  circle: Circle,
  ngon: Hexagon,
};
const FALLBACK: SymbolDef = { fill: '#888888', fillOpacity: 1, stroke: '#444444', strokeWidth: 1, size: 5, shape: 'circle' };

export function CreatePane() {
  const mapId = useActiveMapId();
  const layers = useFeatureLayers();
  const template = useEdit((s) => s.template);
  const construction = useEdit((s) => s.construction);
  const sides = useEdit((s) => s.ngonSides);
  const snapping = useEdit((s) => s.snapping);
  const tool = useActiveTool();
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const editable = layers.filter((x) => x.layer.editable && x.dataset.geomType);
  const locked = layers.filter((x) => !x.layer.editable && x.dataset.geomType);
  const q = filter.trim().toLowerCase();

  const groups = editable
    .map(({ layer, dataset }) => {
      const legend = legendFor(layer, dataset);
      const templates = templatesFor(layer, dataset).map((t, i) => ({ t, symbol: (legend.items[i] ?? legend.items[0])?.symbol ?? FALLBACK }));
      const shown = q ? templates.filter(({ t }) => t.label.toLowerCase().includes(q) || layer.name.toLowerCase().includes(q)) : templates;
      return { layer, dataset, templates: shown };
    })
    .filter((g) => g.templates.length);

  const current = template ? editable.find((x) => x.layer.id === template.layerId) : undefined;
  const family = (current?.dataset.geomType ?? null) as Family | null;
  const creating = tool === 'edit-create';

  const pick = (t: Template, fam: Family | null) => {
    setTemplate(t, fam);
    setTool('edit-create');
  };

  if (!mapId) return <Empty icon={PenTool} title="No map">Open a map to create features.</Empty>;

  return (
    <>
      <div className="pane-toolbar">
        <div className="editing-search grow">
          <Search size={13} />
          <TextInput value={filter} onChange={setFilter} placeholder="Search templates" />
        </div>
        <IconButton icon={Magnet} title={`Snapping ${snapping ? 'on' : 'off'}`} active={snapping} onClick={() => useEdit.setState({ snapping: !snapping })} />
        <IconButton icon={Plus} title="New empty layer…" onClick={() => openDialog('editing.newLayer')} />
      </div>
      <div className="pane-body">
        {editable.length === 0 && (
          <Empty icon={PenTool} title="No editable layers">
            <span>Add data to the map, enable editing on a layer below, or create a new empty layer.</span>
            <button type="button" className="btn primary" onClick={() => openDialog('editing.newLayer')}>
              New Layer…
            </button>
          </Empty>
        )}
        {editable.length > 0 && groups.length === 0 && <div className="muted editing-pad">No templates match "{filter}".</div>}
        {groups.map(({ layer, dataset, templates }) => {
          const closed = collapsed[layer.id];
          return (
            <div key={layer.id} className="editing-tgroup">
              <button type="button" className="editing-tgroup-head" onClick={() => setCollapsed({ ...collapsed, [layer.id]: !closed })}>
                {closed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                <span className="grow">{layer.name}</span>
                <span className="muted">{familyLabel(dataset.geomType)}</span>
              </button>
              {!closed &&
                templates.map(({ t, symbol }) => (
                  <button
                    type="button"
                    key={t.key}
                    className={cx('editing-template', template?.key === t.key && 'selected', template?.key === t.key && creating && 'active')}
                    onClick={() => pick(t, dataset.geomType)}
                    title={Object.keys(t.presets).length ? `Sets ${Object.entries(t.presets).map(([k, v]) => `${k} = ${v ?? 'null'}`).join(', ')}` : `Create ${familyLabel(dataset.geomType)} features in ${layer.name}`}
                  >
                    <SymbolSwatch symbol={symbol} geomType={dataset.geomType} width={24} height={16} />
                    <span className="grow">{t.label}</span>
                  </button>
                ))}
            </div>
          );
        })}
        {locked.length > 0 && (
          <div className="editing-tgroup editing-locked">
            <div className="editing-tgroup-head static">
              <Lock size={12} />
              <span className="grow">Not editable</span>
            </div>
            {locked.map(({ layer }) => (
              <div key={layer.id} className="editing-locked-row">
                <span className="grow" title={layer.name}>{layer.name}</span>
                <button type="button" className="btn ghost" onClick={() => updateLayer(layer.id, { editable: true })} title="Allow editing of this layer">
                  <LockOpen /> Enable
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {current && family && (
        <div className="editing-tools">
          <div className="editing-tools-title">
            <span className="grow">Construction</span>
            <span className="muted" title={current.layer.name}>{template!.label}</span>
          </div>
          <div className="hstack editing-tools-row">
            {CONSTRUCTIONS[family].map((c) => (
              <IconButton
                key={c}
                icon={CONSTRUCTION_ICON[c]}
                title={CONSTRUCTION_LABEL[c]}
                active={creating && construction === c}
                onClick={() => {
                  setConstruction(c);
                  setTool('edit-create');
                }}
              />
            ))}
            {family === 'Polygon' && construction === 'ngon' && (
              <label className="hstack editing-sides" title="Number of sides">
                <span className="muted">Sides</span>
                <NumberInput value={sides} min={3} max={64} step={1} onChange={(v) => useEdit.setState({ ngonSides: Math.round(v) })} style={{ width: 54 }} />
              </label>
            )}
          </div>
        </div>
      )}
    </>
  );
}
