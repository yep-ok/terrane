// The Symbology pane (right dock): Symbology and Labeling tabs for the active feature layer.
import { useEffect, useState } from 'react';
import { Palette } from 'lucide-react';
import type { FeatureLayer, Renderer } from '../../core/types';
import { useDataset } from '../../core/data';
import { updateLayer, useLayer } from '../../core/store';
import { notify, useActiveLayerId } from '../../core/ui';
import { Empty, Row, Select, Tabs } from '../../ui/kit';
import { LabelingPanel } from './LabelingPanel';
import { GraduatedPanel, HeatmapPanel, ProportionalPanel, SinglePanel, UniquePanel } from './panels';
import { RENDERER_LABELS, defaultRenderer, validRendererTypes, type RendererType } from './renderers';
import './symbology.css';

type Tab = 'symbology' | 'labeling';

export function SymbologyPane({ props }: { props?: { layerId?: string; tab?: Tab } }) {
  const activeId = useActiveLayerId();
  const layer = useLayer(activeId);
  const [tab, setTab] = useState<Tab>(props?.tab ?? 'symbology');
  useEffect(() => {
    if (props?.tab) setTab(props.tab);
  }, [props]);

  const feature = layer?.kind === 'feature' ? layer : undefined;
  const ds = useDataset(feature?.datasetId);

  if (!feature || !ds) {
    return (
      <div className="sy-pane" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Empty icon={Palette} title="Symbology">
          Select a feature layer in Contents to style it.
        </Empty>
      </div>
    );
  }
  return (
    <div className="sy-pane" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sy-head">
        <div className="sy-layername">
          <Palette size={14} style={{ flex: 'none', color: 'var(--accent)' }} />
          <span title={feature.name}>{feature.name}</span>
          <span className="sub">{ds.geomType ?? 'Table'} &middot; {ds.features.length.toLocaleString()} features</span>
        </div>
      </div>
      <Tabs<Tab> tabs={[{ id: 'symbology', label: 'Symbology' }, { id: 'labeling', label: 'Labeling' }]} value={tab} onChange={setTab} />
      <div className="pane-body">
        <div className="sy-body" key={feature.id + tab}>
          {tab === 'labeling' ? <LabelingPanel layer={feature} ds={ds} /> : <SymbologyTab layer={feature} ds={ds} />}
        </div>
      </div>
    </div>
  );
}

function SymbologyTab({ layer, ds }: { layer: FeatureLayer; ds: NonNullable<ReturnType<typeof useDataset>> }) {
  const r = layer.renderer;
  const types = validRendererTypes(ds.geomType);
  const apply = (renderer: Renderer) => updateLayer<FeatureLayer>(layer.id, { renderer });
  if (!types.length) return <div className="sy-note">Tables have no geometry to symbolise.</div>;

  const choose = (type: RendererType) => {
    if (type === r.type) return;
    const next = defaultRenderer(type, layer, ds);
    if (!next) {
      notify(type === 'unique' ? 'This layer has no fields to classify.' : 'This layer has no numeric fields.', 'warning');
      return;
    }
    apply(next);
  };
  const props = { layer, ds, apply };
  return (
    <>
      <Row label="Symbology type">
        <Select value={r.type} onChange={(v) => choose(v as RendererType)} options={types.map((t) => ({ value: t, label: RENDERER_LABELS[t] }))} />
      </Row>
      <div style={{ height: 6 }} />
      {r.type === 'single' && <SinglePanel {...props} r={r} />}
      {r.type === 'unique' && <UniquePanel {...props} r={r} />}
      {r.type === 'graduated' && <GraduatedPanel {...props} r={r} />}
      {r.type === 'proportional' && <ProportionalPanel {...props} r={r} />}
      {r.type === 'heatmap' && <HeatmapPanel {...props} r={r} />}
    </>
  );
}
