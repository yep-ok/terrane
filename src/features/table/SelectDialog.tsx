import { useId, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { FieldType, Id } from '../../core/types';
import { useDataset, useDatasetVersion } from '../../core/data';
import { findLayer, useLayer } from '../../core/store';
import { clearSelection, getSelection, notify, setSelection, useSelection } from '../../core/ui';
import { compileWhere, tryCompile } from '../../core/expr';
import { Button, Empty, IconButton, LayerSelect, Row, Select, TextInput, useDebounced } from '../../ui/kit';
import { ExprEditor } from './ExprEditor';
import { clausesToExpr, filterByWhere, opNeedsValue, opsFor, uniqueValues, type Clause, type ClauseOp } from './logic';

type Mode = 'new' | 'add' | 'remove' | 'subset';
const MODES: Array<{ value: Mode; label: string }> = [
  { value: 'new', label: 'Create a new selection' },
  { value: 'add', label: 'Add to the current selection' },
  { value: 'remove', label: 'Remove from the current selection' },
  { value: 'subset', label: 'Select from the current selection' },
];

export function SelectDialog({ props, close }: { props: { layerId?: Id }; close: () => void }) {
  const [layerId, setLayerId] = useState<Id>(props.layerId ?? '');
  const layer = useLayer(layerId);
  const fl = layer?.kind === 'feature' ? layer : undefined;
  const ds = useDataset(fl?.datasetId);
  const version = useDatasetVersion(fl?.datasetId);
  const selection = useSelection(layerId);
  const mapId = findLayer(layerId)?.map.id;

  const nextId = useRef(2);
  const [clauses, setClauses] = useState<Clause[]>([{ id: 1, field: '', op: 'eq', value: '' }]);
  const [joiner, setJoiner] = useState<'AND' | 'OR'>('AND');
  const [expr, setExpr] = useState('');
  const [custom, setCustom] = useState(false);
  const [mode, setMode] = useState<Mode>('new');
  const listId = useId();

  const typeOf = (name: string): FieldType | undefined => ds?.fields.find((f) => f.name === name)?.type;
  const rebuild = (cs: Clause[], j: 'AND' | 'OR') => {
    setClauses(cs);
    setJoiner(j);
    setExpr(clausesToExpr(cs, typeOf, j));
    setCustom(false);
  };
  const patchClause = (id: number, patch: Partial<Clause>) =>
    rebuild(clauses.map((c) => (c.id === id ? { ...c, ...patch } : c)), joiner);

  const changeLayer = (id: Id) => {
    setLayerId(id);
    setClauses([{ id: nextId.current++, field: '', op: 'eq', value: '' }]);
    setExpr('');
    setCustom(false);
  };

  const dExpr = useDebounced(expr, 250);
  const compiled = useMemo(() => (dExpr.trim() ? tryCompile(dExpr) : { error: undefined as string | undefined, fn: undefined }), [dExpr]);
  const visible = useMemo(() => (ds && fl ? filterByWhere(ds.features, fl.definitionQuery) : []), [ds, fl?.definitionQuery, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const matches = useMemo(() => {
    if (!compiled.fn) return null;
    const pred = compileWhere(dExpr);
    const out: number[] = [];
    for (const f of visible) if (pred(f)) out.push(f.id);
    return out;
  }, [compiled.fn, dExpr, visible]);
  const liveError = expr.trim() ? tryCompile(expr).error : undefined;

  const [suggestField, setSuggestField] = useState('');
  const suggestions = useMemo(() => (ds && suggestField ? uniqueValues(visible, suggestField) : []), [ds, visible, suggestField]);

  if (!fl || !ds) {
    return (
      <>
        <div className="dialog-body tbl-dialog">
          <Row label="Layer"><LayerSelect value={layerId} onChange={changeLayer} /></Row>
          <Empty title="Choose a layer">Pick the layer to select features in.</Empty>
        </div>
        <div className="dialog-footer"><Button onClick={close}>Close</Button></div>
      </>
    );
  }

  const apply = (): boolean => {
    if (!expr.trim() || liveError) return false;
    const pred = compileWhere(expr);
    const ids = visible.filter(pred).map((f) => f.id);
    if (mode === 'subset') {
      const set = new Set(ids);
      setSelection(layerId, getSelection(layerId).filter((i) => set.has(i)), 'new');
    } else setSelection(layerId, ids, mode);
    notify(`${ids.length.toLocaleString()} feature${ids.length === 1 ? '' : 's'} matched in "${fl.name}"`, ids.length ? 'info' : 'warning');
    return true;
  };
  const blocked = !expr.trim() || !!liveError;
  const status = liveError
    ? <span className="error-text">{liveError}</span>
    : !expr.trim()
      ? <span className="tbl-faint">Build a query with the clauses above, or type an expression.</span>
      : matches
        ? <span>{matches.length.toLocaleString()} of {visible.length.toLocaleString()} records match.</span>
        : <span className="tbl-faint">Checking…</span>;

  return (
    <>
      <div className="dialog-body tbl-dialog">
        <Row label="Layer"><LayerSelect value={layerId} onChange={changeLayer} mapId={mapId} /></Row>
        <Row label="Selection type">
          <Select<Mode> value={mode} onChange={setMode} options={MODES} />
        </Row>

        <div className="tbl-label">Clauses</div>
        <div className="tbl-clauses">
          {clauses.map((c, i) => {
            const type = typeOf(c.field);
            const ops = type ? opsFor(type) : opsFor('string');
            return (
              <div key={c.id} className="tbl-clause">
                <span className="tbl-joiner">
                  {i === 0 ? 'Where' : (
                    <Select<'AND' | 'OR'> value={joiner} onChange={(j) => rebuild(clauses, j)} options={['AND', 'OR']} />
                  )}
                </span>
                <Select
                  value={c.field}
                  placeholder="Field…"
                  onChange={(field) => {
                    const t = typeOf(field);
                    const op = t && !opsFor(t).some((o) => o.value === c.op) ? 'eq' : c.op;
                    setSuggestField(field);
                    patchClause(c.id, { field, op });
                  }}
                  options={ds.fields.map((f) => ({ value: f.name, label: f.alias ? `${f.alias} (${f.name})` : f.name }))}
                />
                <Select<ClauseOp> value={c.op} onChange={(op) => patchClause(c.id, { op })} options={ops} />
                {opNeedsValue(c.op) ? (
                  <TextInput
                    value={c.value}
                    list={listId}
                    placeholder="Value"
                    onFocus={() => {
                      setSuggestField(c.field);
                    }}
                    onChange={(value) => patchClause(c.id, { value })}
                  />
                ) : (
                  <span />
                )}
                <IconButton
                  icon={X}
                  title="Remove clause"
                  disabled={clauses.length === 1}
                  onClick={() => rebuild(clauses.filter((x) => x.id !== c.id), joiner)}
                />
              </div>
            );
          })}
          <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
          <div>
            <Button variant="ghost" icon={Plus} onClick={() => rebuild([...clauses, { id: nextId.current++, field: '', op: 'eq', value: '' }], joiner)}>
              Add clause
            </Button>
          </div>
        </div>

        <div className="tbl-label">
          Expression {custom && <span className="tbl-faint">(edited manually; changing a clause will replace it)</span>}
        </div>
        <ExprEditor
          datasetId={ds.id}
          value={expr}
          onChange={(v) => {
            setExpr(v);
            setCustom(true);
          }}
          error={liveError}
          rows={3}
          listHeight={100}
        />
        <div className="tbl-msg">{status}</div>
      </div>
      <div className="dialog-footer">
        <span className="tbl-faint grow">{selection.length.toLocaleString()} currently selected</span>
        <Button onClick={() => clearSelection(layerId)} disabled={!selection.length}>Clear selection</Button>
        <Button onClick={apply} disabled={blocked}>Apply</Button>
        <Button variant="primary" onClick={() => apply() && close()} disabled={blocked}>OK</Button>
        <Button onClick={close}>Close</Button>
      </div>
    </>
  );
}
