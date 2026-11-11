// Dataset properties dialog.
import { useMemo } from 'react';
import { Button, Empty } from '../../../ui/kit';
import { datasetExtent, useDataset } from '../../../core/data';
import { useProject } from '../../../core/store';
import type { Id } from '../../../core/types';

const GEOM_LABEL = { Point: 'Point', LineString: 'Line', Polygon: 'Polygon' } as const;

export function datasetUsage(datasetId: Id, maps: ReturnType<typeof useProject.getState>['project']['maps']) {
  const out: Array<{ layerId: Id; layerName: string; mapId: Id; mapName: string }> = [];
  for (const m of maps) for (const l of m.layers) if (l.kind === 'feature' && l.datasetId === datasetId) out.push({ layerId: l.id, layerName: l.name, mapId: m.id, mapName: m.name });
  return out;
}

export function DatasetPropertiesDialog({ props, close }: { props: { datasetId: Id }; close: () => void }) {
  const ds = useDataset(props.datasetId);
  const maps = useProject((s) => s.project.maps);
  const usage = useMemo(() => datasetUsage(props.datasetId, maps), [props.datasetId, maps]);
  if (!ds) {
    return (
      <>
        <div className="dialog-body"><Empty title="Dataset not found" /></div>
        <div className="dialog-footer"><Button onClick={close}>Close</Button></div>
      </>
    );
  }
  const e = datasetExtent(ds.id);
  const fmt = (n: number) => n.toFixed(4);
  return (
    <>
      <div className="dialog-body io-props selectable">
        <table className="io-kv">
          <tbody>
            <tr><th>Name</th><td>{ds.name}</td></tr>
            <tr><th>Type</th><td>{ds.geomType ? `${GEOM_LABEL[ds.geomType]} features` : 'Table (no geometry)'}</td></tr>
            <tr><th>Features</th><td>{ds.features.length.toLocaleString()}</td></tr>
            <tr><th>Source</th><td>{ds.source ?? 'Unknown'}</td></tr>
            <tr><th>Coordinate system</th><td>WGS 1984 (EPSG:4326)</td></tr>
            {e && <tr><th>Extent</th><td>{fmt(e[0])}, {fmt(e[1])} to {fmt(e[2])}, {fmt(e[3])}</td></tr>}
            <tr><th>Used by</th><td>{usage.length ? usage.map((u) => `${u.layerName} (${u.mapName})`).join(', ') : 'Not used in any map'}</td></tr>
          </tbody>
        </table>
        <div className="io-fields-title">Fields ({ds.fields.length})</div>
        <div className="io-fields">
          <table>
            <thead><tr><th>Name</th><th>Alias</th><th>Type</th></tr></thead>
            <tbody>
              {ds.fields.map((f) => (
                <tr key={f.name}><td>{f.name}</td><td>{f.alias ?? ''}</td><td>{f.type}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="dialog-footer"><Button onClick={close}>Close</Button></div>
    </>
  );
}
