import { useRef, useState } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { FieldType } from '../../core/types';
import { addField, deleteField, transaction, updateField, useDataset } from '../../core/data';
import { renameFieldRefs, useLayer } from '../../core/store';
import { notify } from '../../core/ui';
import { Button, Empty, IconButton, Select, TextInput } from '../../ui/kit';
import { FieldTypeIcon, TYPE_OPTIONS } from './shared';

interface Draft {
  key: number;
  orig: string | null;
  name: string;
  alias: string;
  type: FieldType;
  origAlias: string;
  origType: FieldType | null;
  deleted: boolean;
}

export function FieldsDialog({ props, close }: { props: { layerId?: string; addNew?: boolean }; close: () => void }) {
  const layer = useLayer(props.layerId);
  const fl = layer?.kind === 'feature' ? layer : undefined;
  const ds = useDataset(fl?.datasetId);
  const nextKey = useRef(1000);
  const blank = (): Draft => ({ key: nextKey.current++, orig: null, name: '', alias: '', type: 'string', origAlias: '', origType: null, deleted: false });
  const [rows, setRows] = useState<Draft[]>(() => {
    const base: Draft[] = (ds?.fields ?? []).map((f, i) => ({
      key: i, orig: f.name, name: f.name, alias: f.alias ?? '', type: f.type, origAlias: f.alias ?? '', origType: f.type, deleted: false,
    }));
    return props.addNew ? [...base, blank()] : base;
  });
  const [focusKey, setFocusKey] = useState<number | null>(props.addNew ? 1000 : null);

  if (!fl || !ds) {
    return (
      <>
        <div className="dialog-body"><Empty title="No layer">Select a feature layer first.</Empty></div>
        <div className="dialog-footer"><Button onClick={close}>Close</Button></div>
      </>
    );
  }

  const patch = (key: number, p: Partial<Draft>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const live = rows.filter((r) => !r.deleted);
  const errorOf = (r: Draft): string | null => {
    if (r.deleted) return null;
    const n = r.name.trim();
    if (!n) return r.orig === null ? null : 'Name is required';
    if (/[\[\]]/.test(n)) return 'Cannot contain [ or ]';
    if (live.some((o) => o !== r && o.name.trim().toLowerCase() === n.toLowerCase())) return 'Duplicate name';
    return null;
  };
  const errors = rows.map(errorOf);
  const hasError = errors.some(Boolean);
  const changed = (r: Draft) =>
    r.deleted || (r.orig === null ? r.name.trim() !== '' : r.name.trim() !== r.orig || r.alias.trim() !== r.origAlias || r.type !== r.origType);
  const dirty = rows.some(changed);
  const typeChanges = rows.filter((r) => !r.deleted && r.orig !== null && r.type !== r.origType).length;
  const deletions = rows.filter((r) => r.deleted && r.orig !== null).length;

  const apply = () => {
    if (hasError || !dirty) return;
    try {
      transaction('Modify fields', () => {
        for (const r of rows) if (r.deleted && r.orig !== null) deleteField(ds.id, r.orig);
        // Rename through temporary names first so swaps and chains cannot collide.
        const cur = new Map<Draft, string>();
        rows.forEach((r, i) => {
          if (r.deleted || r.orig === null) return;
          if (r.name.trim() !== r.orig) {
            const tmp = `__rename_${i}`;
            updateField(ds.id, r.orig, { name: tmp });
            cur.set(r, tmp);
          } else cur.set(r, r.orig);
        });
        for (const [r, now] of cur) {
          const name = r.name.trim();
          const alias = r.alias.trim() || undefined;
          if (now !== name || alias !== (r.origAlias || undefined) || r.type !== r.origType) updateField(ds.id, now, { name, alias, type: r.type });
          if (r.orig !== null && r.orig !== name) renameFieldRefs(ds.id, r.orig, name);
        }
        for (const r of rows) {
          if (r.deleted || r.orig !== null || !r.name.trim()) continue;
          addField(ds.id, { name: r.name.trim(), alias: r.alias.trim() || undefined, type: r.type });
        }
      });
      notify('Fields updated', 'success');
      close();
    } catch (e: any) {
      notify(`Fields: ${e?.message ?? e}`, 'error');
    }
  };

  return (
    <>
      <div className="dialog-body tbl-dialog">
        <div className="tbl-label">{fl.name} · {ds.features.length.toLocaleString()} records</div>
        <div className="tbl-fields">
          <div className="tbl-frow head">
            <span />
            <span>Field name</span>
            <span>Alias</span>
            <span>Type</span>
            <span />
          </div>
          {rows.map((r, i) => (
            <div key={r.key} className={`tbl-frow${r.deleted ? ' deleted' : ''}${changed(r) && !r.deleted ? ' changed' : ''}`}>
              <FieldTypeIcon type={r.type} size={13} />
              <TextInput
                value={r.name}
                disabled={r.deleted}
                invalid={!!errors[i]}
                title={errors[i] ?? undefined}
                placeholder={r.orig === null ? 'New field name' : ''}
                autoFocus={r.key === focusKey}
                onFocus={() => setFocusKey(null)}
                onChange={(name) => patch(r.key, { name })}
              />
              <TextInput value={r.alias} disabled={r.deleted} placeholder="(none)" onChange={(alias) => patch(r.key, { alias })} />
              <Select<FieldType> value={r.type} disabled={r.deleted} onChange={(type) => patch(r.key, { type })} options={TYPE_OPTIONS} />
              {r.deleted ? (
                <IconButton icon={RotateCcw} title="Restore field" onClick={() => patch(r.key, { deleted: false })} />
              ) : (
                <IconButton
                  icon={Trash2}
                  title="Delete field"
                  onClick={() => (r.orig === null ? setRows((rs) => rs.filter((x) => x.key !== r.key)) : patch(r.key, { deleted: true }))}
                />
              )}
              {errors[i] && <div className="tbl-ferr error-text">{errors[i]}</div>}
            </div>
          ))}
        </div>
        <div>
          <Button
            variant="ghost"
            icon={Plus}
            onClick={() => {
              const b = blank();
              setRows((rs) => [...rs, b]);
              setFocusKey(b.key);
            }}
          >
            Add field
          </Button>
        </div>
        {(typeChanges > 0 || deletions > 0) && (
          <div className="tbl-msg tbl-warn">
            {typeChanges > 0 && 'Changing a type converts existing values; values that cannot be converted become null. '}
            {deletions > 0 && `${deletions} field${deletions > 1 ? 's' : ''} will be deleted (undo is available).`}
          </div>
        )}
        {!fl.editable && <div className="tbl-msg tbl-faint">This layer is marked not editable; schema changes still apply to its dataset.</div>}
      </div>
      <div className="dialog-footer">
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={apply} disabled={!dirty || hasError}>Apply</Button>
      </div>
    </>
  );
}
