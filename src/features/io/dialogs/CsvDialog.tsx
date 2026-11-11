// Delimited text import options: which columns hold coordinates / WKT, and in which CRS.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Row, Select, TextInput } from '../../../ui/kit';
import { CRS_LIST, ensureCrsSync } from '../../../core/crs';
import type { CsvDetection, Table } from '../parse/csv';
import { tableToFeatures } from '../parse/csv';
import type { CsvChoice } from '../importer';

type Mode = CsvChoice['mode'];

export function CsvDialog({ props, close }: { props: { name: string; table: Table; detection: CsvDetection; resolve: (c: CsvChoice | null) => void }; close: () => void }) {
  const { table, detection } = props;
  const [mode, setMode] = useState<Mode>(detection.x && detection.y ? 'xy' : detection.wkt ? 'wkt' : 'xy');
  const [x, setX] = useState(detection.x ?? '');
  const [y, setY] = useState(detection.y ?? '');
  const [wkt, setWkt] = useState(detection.wkt ?? '');
  const known = CRS_LIST.some((c) => c.code === detection.crs);
  const [crsSel, setCrsSel] = useState(known ? detection.crs : 'other');
  const [custom, setCustom] = useState(known ? '' : detection.crs);
  const done = useRef(false);
  useEffect(() => () => {
    if (!done.current) {
      done.current = true;
      props.resolve(null);
    }
  }, []);

  const crs = crsSel === 'other' ? custom.trim().toUpperCase() : crsSel;
  const crsValid = /^(EPSG|ESRI):\d+$/.test(crs);
  const headers = table.headers;
  const colOptions = headers.map((h) => ({ value: h, label: h }));

  const preview = useMemo(() => {
    if (mode === 'table') return null;
    if (mode === 'xy' && (!x || !y)) return null;
    if (mode === 'wkt' && !wkt) return null;
    if (!crsValid || (crs !== 'EPSG:4326' && !ensureCrsSync(crs))) return { unknown: true as const };
    try {
      const sample = { ...table, rows: table.rows.slice(0, 500) };
      const r = tableToFeatures(sample, mode === 'xy' ? { x, y, crs } : { wkt, crs });
      return { located: r.located, total: sample.rows.length, unknown: false as const };
    } catch {
      return null;
    }
  }, [mode, x, y, wkt, crs, crsValid, table]);

  const valid = mode === 'table' || (mode === 'xy' ? !!x && !!y && x !== y : !!wkt) && crsValid;
  const finish = (c: CsvChoice | null) => {
    if (done.current) return;
    done.current = true;
    props.resolve(c);
    close();
  };

  return (
    <>
      <div className="dialog-body io-csv">
        <div className="vstack" style={{ gap: 4, marginBottom: 10 }}>
          <div>
            <b className="selectable">{props.name}</b> <span className="muted">{table.rows.length.toLocaleString()} rows, {headers.length} columns</span>
          </div>
        </div>
        <Row label="Locate rows by">
          <Select<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'xy', label: 'X / Y coordinate columns' },
              { value: 'wkt', label: 'WKT geometry column' },
              { value: 'table', label: 'Nothing (standalone table)' },
            ]}
          />
        </Row>
        {mode === 'xy' && (
          <>
            <Row label="X field (longitude)">
              <Select value={x} onChange={setX} options={colOptions} placeholder="Select a field…" />
            </Row>
            <Row label="Y field (latitude)">
              <Select value={y} onChange={setY} options={colOptions} placeholder="Select a field…" />
            </Row>
          </>
        )}
        {mode === 'wkt' && (
          <Row label="WKT field">
            <Select value={wkt} onChange={setWkt} options={colOptions} placeholder="Select a field…" />
          </Row>
        )}
        {mode !== 'table' && (
          <>
            <Row label="Coordinate system">
              <Select
                value={crsSel}
                onChange={setCrsSel}
                options={[...CRS_LIST.map((c) => ({ value: c.code, label: `${c.code}  ${c.name}` })), { value: 'other', label: 'Other (enter code)…' }]}
              />
            </Row>
            {crsSel === 'other' && (
              <Row label="Code" hint="For example EPSG:32633 or EPSG:27700. Unknown codes are looked up online.">
                <TextInput value={custom} onChange={setCustom} invalid={!!custom && !crsValid} placeholder="EPSG:4326" />
              </Row>
            )}
            {preview && !preview.unknown && (
              <div className={preview.located === 0 ? 'error-text' : 'muted'}>
                {preview.located.toLocaleString()} of {preview.total.toLocaleString()} sample rows land on valid coordinates.
              </div>
            )}
            {!detection.x && mode === 'xy' && <div className="muted">No obvious coordinate columns were found; choose them above.</div>}
          </>
        )}
        <div className="io-preview">
          <table>
            <thead>
              <tr>
                {headers.slice(0, 12).map((h) => (
                  <th key={h} className={h === x || h === y || h === wkt ? 'hl' : ''}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.slice(0, 5).map((r, i) => (
                <tr key={i}>
                  {r.slice(0, 12).map((v, j) => (
                    <td key={j}>{v === null ? '' : String(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="dialog-footer">
        <Button onClick={() => finish(null)}>Cancel</Button>
        <Button variant="primary" disabled={!valid} onClick={() => finish({ mode, x: x || null, y: y || null, wkt: wkt || null, crs: mode === 'table' ? 'EPSG:4326' : crs })}>
          Import
        </Button>
      </div>
    </>
  );
}
