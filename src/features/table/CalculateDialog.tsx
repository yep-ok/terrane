import { useMemo, useState } from 'react';
import type { FieldType } from '../../core/types';
import { addField, setFieldValues, transaction, useDataset, useDatasetVersion } from '../../core/data';
import { findFeatureLayer, useLayer } from '../../core/store';
import { notify, useSelection } from '../../core/ui';
import { referencedFields, tryCompile } from '../../core/expr';
import { Button, Checkbox, Empty, Row, Select, TextInput } from '../../ui/kit';
import { ExprEditor } from './ExprEditor';
import { evaluateCalc, fieldNameError, filterByWhere, formatCell } from './logic';
import { TYPE_OPTIONS } from './shared';

const NEW = '__new__';

export function CalculateDialog({ props, close }: { props: { layerId?: string; field?: string }; close: () => void }) {
  const layerId = props.layerId ?? '';
  const layer = useLayer(layerId);
  const fl = layer?.kind === 'feature' ? layer : undefined;
  const ds = useDataset(fl?.datasetId);
  const version = useDatasetVersion(fl?.datasetId);
  const selection = useSelection(layerId);

  const [target, setTarget] = useState<string>(props.field ?? ds?.fields[0]?.name ?? NEW);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<FieldType>('number');
  const [expr, setExpr] = useState('');
  const [selOnly, setSelOnly] = useState(false);

  const effSelOnly = selOnly && selection.length > 0;
  const feats = useMemo(() => {
    if (!ds || !fl) return [];
    let r = filterByWhere(ds.features, fl.definitionQuery);
    if (effSelOnly) {
      const s = new Set(selection);
      r = r.filter((f) => s.has(f.id));
    }
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, fl?.definitionQuery, version, effSelOnly, selection]);

  const isNew = target === NEW;
  const existing = ds?.fields.find((f) => f.name === target);
  const type: FieldType = isNew ? newType : existing?.type ?? 'string';
  const compiled = useMemo(() => (expr.trim() ? tryCompile(expr) : { error: undefined as string | undefined, fn: undefined }), [expr]);
  const nameError = isNew && ds ? fieldNameError(newName, ds.fields.map((f) => f.name)) : null;
  const unknown = useMemo(() => {
    if (!ds || !compiled.fn) return [];
    const names = new Set(ds.fields.map((f) => f.name.toLowerCase()));
    return referencedFields(expr).filter((n) => !names.has(n.toLowerCase()));
  }, [ds, compiled.fn, expr]);

  const preview = useMemo(() => {
    if (!compiled.fn) return [];
    const sample = feats.slice(0, 5);
    const vals = evaluateCalc(sample, expr, type);
    return sample.map((f) => ({ id: f.id, old: isNew ? null : f.properties[target], next: vals.get(f.id) }));
  }, [compiled.fn, feats, expr, type, isNew, target]);

  if (!fl || !ds) {
    return (
      <>
        <div className="dialog-body"><Empty title="No layer">Select a feature layer first.</Empty></div>
        <div className="dialog-footer"><Button onClick={close}>Close</Button></div>
      </>
    );
  }

  const blocked = !fl.editable ? 'This layer is not editable.' : !expr.trim() ? 'Enter an expression.' : compiled.error ? compiled.error : nameError;
  const run = () => {
    if (blocked) return;
    const name = isNew ? newName.trim() : target;
    try {
      transaction(`Calculate ${name}`, () => {
        const vals = evaluateCalc(feats, expr, type);
        if (isNew) addField(ds.id, { name, type });
        setFieldValues(ds.id, name, vals, `Calculate ${name}`);
      });
      notify(`Calculated ${feats.length.toLocaleString()} value${feats.length === 1 ? '' : 's'} in "${name}"`, 'success');
      close();
    } catch (e: any) {
      notify(`Calculate Field: ${e?.message ?? e}`, 'error');
    }
  };

  return (
    <>
      <div className="dialog-body tbl-dialog">
        <Row label="Layer">
          <span className="grow tbl-ellipsis">{fl.name}</span>
        </Row>
        <Row label="Field to set">
          <Select
            value={target}
            onChange={setTarget}
            options={[...ds.fields.map((f) => ({ value: f.name, label: f.alias ? `${f.alias} (${f.name})` : f.name })), { value: NEW, label: '<New field…>' }]}
          />
        </Row>
        {isNew && (
          <Row label="New field">
            <TextInput value={newName} onChange={setNewName} placeholder="Field name" invalid={!!newName && !!nameError} autoFocus />
            <Select<FieldType> value={newType} onChange={setNewType} options={TYPE_OPTIONS} style={{ width: 110 }} />
          </Row>
        )}
        {isNew && newName && nameError && <div className="tbl-msg error-text">{nameError}</div>}
        <div className="tbl-label">Expression</div>
        <ExprEditor
          datasetId={ds.id}
          value={expr}
          onChange={setExpr}
          error={compiled.error}
          placeholder={"e.g.  Round(Area('sqkm'), 2)   or   Upper(NAME) + ' (' + Round(POP / 1e6, 1) + 'M)'"}
        />
        <div className={compiled.error ? 'tbl-msg error-text' : 'tbl-msg tbl-faint'}>
          {compiled.error ? compiled.error : expr.trim() ? 'Expression is valid.' : 'Enter an expression to preview results.'}
          {unknown.length > 0 && !compiled.error && <span className="tbl-warn"> Unknown field{unknown.length > 1 ? 's' : ''}: {unknown.join(', ')} (evaluates to null).</span>}
        </div>
        <Checkbox
          checked={effSelOnly}
          onChange={setSelOnly}
          disabled={selection.length === 0}
          label={selection.length ? `Selected records only (${selection.length.toLocaleString()})` : 'Selected records only (none selected)'}
        />
        <div className="tbl-label">Preview (first {Math.min(5, feats.length)} of {feats.length.toLocaleString()} records)</div>
        <table className="tbl-preview">
          <thead>
            <tr><th>FID</th><th>Current</th><th>Result</th></tr>
          </thead>
          <tbody>
            {preview.length === 0 && <tr><td colSpan={3} className="tbl-faint">{compiled.fn ? 'No records.' : 'Nothing to preview.'}</td></tr>}
            {preview.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td className="tbl-faint">{formatCell(p.old, type) || '<Null>'}</td>
                <td>{formatCell(p.next, type) || '<Null>'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dialog-footer">
        {blocked && expr.trim() && <span className="tbl-msg error-text grow">{blocked}</span>}
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={run} disabled={!!blocked}>OK</Button>
      </div>
    </>
  );
}

/** Used by commands to validate a layer before opening. */
export const hasFeatureLayer = (layerId: string | null | undefined) => !!findFeatureLayer(layerId);
