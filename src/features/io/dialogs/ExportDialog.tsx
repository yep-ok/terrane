// Export Features dialog (layer.export).
import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Button, Checkbox, Row, Select, TextInput, downloadBlob } from '../../../ui/kit';
import { getDataset, useDataset } from '../../../core/data';
import { findFeatureLayer, useProject } from '../../../core/store';
import { getSelection, notify, setBusy, useUi } from '../../../core/ui';
import { tryCompile } from '../../../core/expr';
import type { Dataset, FeatureLayer, Id } from '../../../core/types';
import { EXPORT_FORMATS, exportToBlob, safeFileName, type CsvGeometry, type ExportFormat, type ExportSource } from '../export/formats';
import { tick } from '../importer';

/** The features of a layer as an export source, honouring selection and the definition query. */
export function buildExportSource(layer: FeatureLayer, ds: Dataset, opts: { selectedOnly: boolean; definitionQuery: boolean }): ExportSource {
  let features = ds.features;
  if (opts.selectedOnly) {
    const sel = new Set(getSelection(layer.id));
    features = features.filter((f) => sel.has(f.id));
  }
  if (opts.definitionQuery && layer.definitionQuery?.trim()) {
    const { fn } = tryCompile(layer.definitionQuery);
    if (fn) features = features.filter((f) => !!fn(f));
  }
  return { name: layer.name, geomType: ds.geomType, fields: ds.fields, features: features.map((f) => ({ geometry: f.geometry, properties: f.properties })) };
}

export function ExportDialog({ props, close }: { props: { layerId?: Id }; close: () => void }) {
  const maps = useProject((s) => s.project.maps);
  const activeLayerId = useUi((s) => s.activeLayerId);
  const layers = useMemo(() => {
    const out: Array<{ layer: FeatureLayer; map: string }> = [];
    for (const m of maps) for (const l of m.layers) if (l.kind === 'feature') out.push({ layer: l, map: m.name });
    return out;
  }, [maps]);
  const initial = props.layerId ?? activeLayerId ?? layers[0]?.layer.id ?? '';
  const [layerId, setLayerId] = useState<Id>(layers.some((l) => l.layer.id === initial) ? initial : layers[0]?.layer.id ?? '');
  const hit = findFeatureLayer(layerId);
  const ds = useDataset(hit?.layer.datasetId);
  const selection = useUi((s) => (layerId ? s.selection[layerId] : undefined));
  const selCount = selection?.length ?? 0;

  const [format, setFormat] = useState<ExportFormat>('geojson');
  const [selectedOnly, setSelectedOnly] = useState(selCount > 0);
  const [defQuery, setDefQuery] = useState(true);
  const [csvGeom, setCsvGeom] = useState<CsvGeometry | ''>('');
  const [fileName, setFileName] = useState(hit ? safeFileName(hit.layer.name) : '');
  const [named, setNamed] = useState(false);

  const geomType = ds?.geomType ?? null;
  const fmtDisabled = (f: ExportFormat) => (f === 'gpx' && (geomType === 'Polygon' || !geomType)) || (f === 'shapefile' && !geomType);
  const effectiveFormat: ExportFormat = fmtDisabled(format) ? 'geojson' : format;
  const csvDefault: CsvGeometry = geomType === 'Point' ? 'xy' : geomType ? 'wkt' : 'none';
  const csvMode: CsvGeometry = csvGeom || csvDefault;
  const hasDef = !!hit?.layer.definitionQuery?.trim();

  const count = useMemo(() => {
    if (!hit || !ds) return 0;
    return buildExportSource(hit.layer, ds, { selectedOnly: selectedOnly && selCount > 0, definitionQuery: defQuery }).features.length;
  }, [hit, ds, selectedOnly, selCount, defQuery]);

  const info = EXPORT_FORMATS.find((f) => f.id === effectiveFormat)!;

  const run = async () => {
    const h = findFeatureLayer(layerId);
    const d = h && getDataset(h.layer.datasetId);
    if (!h || !d) return;
    setBusy('Exporting…');
    try {
      await tick();
      const src = buildExportSource(h.layer, d, { selectedOnly: selectedOnly && selCount > 0, definitionQuery: defQuery });
      if (!src.features.length) throw new Error('There are no features to export');
      const { blob, notes } = await exportToBlob(effectiveFormat, { ...src, name: safeFileName(fileName || h.layer.name) }, { csvGeometry: csvMode });
      downloadBlob(blob, `${safeFileName(fileName || h.layer.name)}.${info.ext}`);
      notify(`Exported ${src.features.length.toLocaleString()} feature${src.features.length === 1 ? '' : 's'} to ${safeFileName(fileName || h.layer.name)}.${info.ext}${notes.length ? '. ' + notes.join('. ') + '.' : ''}`, notes.length ? 'warning' : 'success');
      close();
    } catch (e: any) {
      notify(`Export failed: ${e?.message ?? e}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!layers.length) {
    return (
      <>
        <div className="dialog-body">There are no feature layers to export. Add data to a map first.</div>
        <div className="dialog-footer"><Button onClick={close}>Close</Button></div>
      </>
    );
  }

  return (
    <>
      <div className="dialog-body io-export">
        <Row label="Layer">
          <Select
            value={layerId}
            onChange={(id) => {
              setLayerId(id);
              const l = layers.find((x) => x.layer.id === id)?.layer;
              if (l && !named) setFileName(safeFileName(l.name));
              setSelectedOnly((useUi.getState().selection[id]?.length ?? 0) > 0);
              setCsvGeom('');
            }}
            options={layers.map((l) => ({ value: l.layer.id, label: maps.length > 1 ? `${l.layer.name}  (${l.map})` : l.layer.name }))}
          />
        </Row>
        <Row label="Format">
          <Select<ExportFormat>
            value={effectiveFormat}
            onChange={setFormat}
            options={EXPORT_FORMATS.map((f) => ({ value: f.id, label: f.label, disabled: fmtDisabled(f.id) }))}
          />
        </Row>
        {effectiveFormat === 'csv' && (
          <Row label="Geometry">
            <Select<CsvGeometry>
              value={csvMode}
              onChange={setCsvGeom}
              options={[
                ...(geomType === 'Point' ? [{ value: 'xy' as const, label: 'X and Y columns' }] : geomType ? [{ value: 'xy' as const, label: 'X and Y columns (feature centre)' }] : []),
                ...(geomType ? [{ value: 'wkt' as const, label: 'WKT column' }] : []),
                { value: 'none' as const, label: 'Attributes only' },
              ]}
            />
          </Row>
        )}
        <Row label="File name">
          <TextInput
            value={fileName}
            onChange={(v) => {
              setFileName(v);
              setNamed(true);
            }}
            invalid={!fileName.trim()}
          />
          <span className="muted">.{info.ext}</span>
        </Row>
        <div className="io-export-opts">
          <Checkbox checked={selectedOnly && selCount > 0} disabled={selCount === 0} onChange={setSelectedOnly} label={`Selected features only${selCount ? ` (${selCount.toLocaleString()})` : ' (none selected)'}`} />
          <Checkbox checked={defQuery && hasDef} disabled={!hasDef} onChange={setDefQuery} label="Apply the layer's definition query" />
        </div>
        <div className="muted io-note">
          {count.toLocaleString()} feature{count === 1 ? '' : 's'} will be exported in WGS 1984 (EPSG:4326).
          {effectiveFormat === 'shapefile' && ' Field names are limited to 10 characters.'}
        </div>
      </div>
      <div className="dialog-footer">
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon={Download} disabled={!fileName.trim() || !count} onClick={() => void run()}>
          Export
        </Button>
      </div>
    </>
  );
}
