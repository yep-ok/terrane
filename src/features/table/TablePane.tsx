import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowDown, ArrowLeftRight, ArrowUp, Calculator, Columns3, Eraser, EyeOff, Filter, ListFilter, ListTree, Plus, Search, Sigma,
  Table2, Trash2, X, ZoomIn,
} from 'lucide-react';
import type { Feat, FeatureLayer, Field, Id } from '../../core/types';
import { applyEdits, deleteField, featureById, useDataset, useDatasetVersion } from '../../core/data';
import { useLayer } from '../../core/store';
import { clearSelection, closeTable, notify, openDialog, setSelection, showContextMenu, useSelection, useUi, type MenuItem } from '../../core/ui';
import { Empty, IconButton, openMenuAt, useDebounced } from '../../ui/kit';
import './table.css';
import { filterByWhere, formatCell, isNumericType, parseEdit, searchFeatures, sortFeatures } from './logic';
import { FieldTypeIcon, mapHandleFor, TYPE_LABEL } from './shared';
import { getTableState, patchTable, useLayerTable } from './state';

const ROW_H = 22;
const HEAD_H = 28;
const GUTTER_W = 50;
const MIN_COL = 40;

// ---------- pane: tabs for the open tables ----------

function TableTab({ layerId, active }: { layerId: Id; active: boolean }) {
  const layer = useLayer(layerId);
  return (
    <div
      className={`tbl-tab${active ? ' active' : ''}`}
      role="tab"
      aria-selected={active}
      onClick={() => useUi.setState({ activeTable: layerId })}
      onAuxClick={(e) => e.button === 1 && closeTable(layerId)}
    >
      <Table2 size={13} />
      <span className="tbl-ellipsis">{layer?.name ?? 'Table'}</span>
      <button type="button" className="tbl-tab-x" title="Close table" aria-label="Close table" onClick={(e) => { e.stopPropagation(); closeTable(layerId); }}>
        <X size={12} />
      </button>
    </div>
  );
}

export function TablePane() {
  const openTables = useUi((s) => s.openTables);
  const activeTable = useUi((s) => s.activeTable);
  const active = activeTable && openTables.includes(activeTable) ? activeTable : openTables[0] ?? null;
  if (!active) {
    return <Empty icon={Table2} title="No attribute table open">Choose a layer and click Attribute Table on the Layer ribbon.</Empty>;
  }
  return (
    <div className="tbl-pane">
      <div className="tbl-tabs" role="tablist">
        {openTables.map((id) => <TableTab key={id} layerId={id} active={id === active} />)}
      </div>
      <TableView key={active} layerId={active} />
    </div>
  );
}

function TableView({ layerId }: { layerId: Id }) {
  const layer = useLayer(layerId);
  const fl = layer?.kind === 'feature' ? layer : undefined;
  const ds = useDataset(fl?.datasetId);
  if (!fl || !ds) return <Empty icon={Table2} title="Table unavailable">The layer or its dataset no longer exists.</Empty>;
  return <Grid layerId={layerId} />;
}

// ---------- grid ----------

interface EditState {
  fid: number;
  field: string;
  text: string;
}

function defaultWidth(f: Field, sample: Feat[]): number {
  let max = Math.min(40, (f.alias || f.name).length + 4);
  for (const row of sample) {
    const t = formatCell(row.properties[f.name], f.type);
    if (t.length > max) max = t.length;
  }
  const cap = f.type === 'string' ? 320 : 180;
  return Math.max(70, Math.min(cap, Math.round(max * 7 + 22)));
}

function Grid({ layerId }: { layerId: Id }) {
  const layer = useLayer(layerId);
  const fl = layer as FeatureLayer;
  const ds = useDataset(fl.datasetId)!;
  const version = useDatasetVersion(fl.datasetId);
  const selection = useSelection(layerId);
  const st = useLayerTable(layerId);
  const search = useDebounced(st.search, 200);
  const [edit, setEdit] = useState<EditState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);
  const cancelled = useRef(false);

  const editable = fl.editable;
  const defQuery = fl.definitionQuery;

  // Row pipeline: definition query -> search -> sort -> (selected only).
  const visibleAll = useMemo(() => filterByWhere(ds.features, defQuery), [ds, version, defQuery]); // eslint-disable-line react-hooks/exhaustive-deps
  const searched = useMemo(() => searchFeatures(visibleAll, ds.fields, search), [visibleAll, ds.fields, search]);
  const sortField = st.sort ? ds.fields.find((f) => f.name === st.sort!.field) : undefined;
  const sorted = useMemo(
    () => (sortField && st.sort ? sortFeatures(searched, st.sort, sortField.type) : searched),
    [searched, sortField, st.sort],
  );
  const selSet = useMemo(() => new Set(selection), [selection]);
  const rows = useMemo(() => (st.selOnly ? sorted.filter((f) => selSet.has(f.id)) : sorted), [sorted, st.selOnly, selSet]);

  const columns = useMemo(() => ds.fields.filter((f) => !st.hidden.includes(f.name)), [ds.fields, st.hidden]);
  const autoWidths = useMemo(() => {
    const sample = ds.features.slice(0, 120);
    const out: Record<string, number> = {};
    for (const f of ds.fields) out[f.name] = defaultWidth(f, sample);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds.fields, ds.id]);
  const widthOf = (f: Field) => st.widths[f.name] ?? autoWidths[f.name] ?? 120;
  const totalWidth = GUTTER_W + columns.reduce((n, f) => n + widthOf(f), 0);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 14,
    scrollMargin: HEAD_H,
  });

  // Reset the range anchor and any open editor when the row set changes shape.
  useEffect(() => {
    anchor.current = null;
  }, [st.sort, search, st.selOnly]);
  useEffect(() => {
    if (edit && !ds.fields.some((f) => f.name === edit.field)) setEdit(null);
  }, [ds.fields, edit]);

  // ----- selection -----
  const onGutterClick = useCallback(
    (e: ReactMouseEvent, index: number) => {
      const fid = rows[index]?.id;
      if (fid === undefined) return;
      const additive = e.ctrlKey || e.metaKey;
      if (e.shiftKey && anchor.current !== null) {
        const [a, b] = anchor.current < index ? [anchor.current, index] : [index, anchor.current];
        setSelection(layerId, rows.slice(a, b + 1).map((f) => f.id), additive ? 'add' : 'new');
      } else if (additive) {
        setSelection(layerId, [fid], 'toggle');
        anchor.current = index;
      } else {
        setSelection(layerId, [fid], 'new');
        anchor.current = index;
      }
    },
    [rows, layerId],
  );

  const zoomToRow = useCallback(
    (index: number) => {
      const f = rows[index];
      if (!f) return;
      if (!f.geometry) return notify('This record has no geometry.', 'info');
      const h = mapHandleFor(layerId);
      if (!h) return notify('Open the map to zoom to a feature.', 'info');
      h.zoomToFeatures(layerId, [f.id]);
      h.flash([f.geometry]);
    },
    [rows, layerId],
  );

  // ----- editing -----
  const startEdit = useCallback(
    (f: Feat, field: Field) => {
      if (!editable) return notify('This layer is not editable. Turn on editing for the layer first.', 'warning');
      const v = f.properties[field.name];
      cancelled.current = false;
      setEdit({ fid: f.id, field: field.name, text: v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v) });
    },
    [editable],
  );
  const commitEdit = () => {
    if (!edit || cancelled.current) return setEdit(null);
    const field = ds.fields.find((f) => f.name === edit.field);
    const feat = featureById(ds.id, edit.fid);
    setEdit(null);
    if (!field || !feat) return;
    const res = parseEdit(edit.text, field.type);
    if (!res.ok) return notify(res.error, 'error');
    const old = feat.properties[field.name] ?? null;
    if (res.value === old) return;
    applyEdits(ds.id, { updates: [{ id: feat.id, properties: { [field.name]: res.value } }] }, { label: `Edit ${field.name}` });
  };

  // ----- columns -----
  const cycleSort = (f: Field) => {
    const cur = st.sort;
    if (!cur || cur.field !== f.name) patchTable(layerId, { sort: { field: f.name, dir: 'asc' } });
    else if (cur.dir === 'asc') patchTable(layerId, { sort: { field: f.name, dir: 'desc' } });
    else patchTable(layerId, { sort: null });
  };
  const startResize = (e: ReactPointerEvent<HTMLElement>, f: Field) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = widthOf(f);
    const move = (ev: PointerEvent) =>
      patchTable(layerId, { widths: { ...getTableState(layerId).widths, [f.name]: Math.max(MIN_COL, Math.round(w0 + ev.clientX - x0)) } });
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const headerMenu = (e: ReactMouseEvent, f: Field) => {
    const items: MenuItem[] = [
      { label: 'Sort ascending', icon: <ArrowUp />, checked: st.sort?.field === f.name && st.sort.dir === 'asc', onClick: () => patchTable(layerId, { sort: { field: f.name, dir: 'asc' } }) },
      { label: 'Sort descending', icon: <ArrowDown />, checked: st.sort?.field === f.name && st.sort.dir === 'desc', onClick: () => patchTable(layerId, { sort: { field: f.name, dir: 'desc' } }) },
      { label: 'Clear sort', disabled: !st.sort, onClick: () => patchTable(layerId, { sort: null }) },
      'separator',
      { label: 'Calculate Field…', icon: <Calculator />, disabled: !editable, onClick: () => openDialog('table.calculate', { layerId, field: f.name }) },
      { label: 'Statistics…', icon: <Sigma />, disabled: !isNumericType(f.type), onClick: () => openDialog('table.statistics', { layerId, field: f.name }) },
      'separator',
      { label: 'Hide field', icon: <EyeOff />, disabled: columns.length <= 1, onClick: () => patchTable(layerId, { hidden: [...st.hidden, f.name] }) },
      {
        label: 'Delete field',
        icon: <Trash2 />,
        danger: true,
        disabled: !editable,
        onClick: () => {
          deleteField(ds.id, f.name);
          notify(`Deleted field "${f.name}" (Ctrl+Z to undo)`, 'info');
        },
      },
      'separator',
      { label: 'Fields…', icon: <ListTree />, onClick: () => openDialog('table.fields', { layerId }) },
    ];
    showContextMenu(e, items);
  };

  // ----- toolbar actions -----
  const hasSel = selection.length > 0;
  const zoomSel = () => {
    const h = mapHandleFor(layerId);
    if (!h) return notify('Open the map to zoom to the selection.', 'info');
    h.zoomToSelection(layerId);
  };
  const switchSel = () => {
    const next = visibleAll.filter((f) => !selSet.has(f.id)).map((f) => f.id);
    setSelection(layerId, next, 'new');
  };
  const deleteSel = () => {
    if (!editable) return notify('This layer is not editable.', 'warning');
    const ids = selection.filter((id) => ds.features.some((f) => f.id === id));
    if (!ids.length) return;
    applyEdits(ds.id, { deletes: ids }, { label: `Delete ${ids.length} feature${ids.length === 1 ? '' : 's'}` });
    clearSelection(layerId);
    notify(`Deleted ${ids.length.toLocaleString()} feature${ids.length === 1 ? '' : 's'} (Ctrl+Z to undo)`, 'info');
  };
  const columnsMenu = (e: ReactMouseEvent<HTMLElement>) => {
    const items: MenuItem[] = ds.fields.map((f) => ({
      label: f.alias ? `${f.alias} (${f.name})` : f.name,
      checked: !st.hidden.includes(f.name),
      disabled: !st.hidden.includes(f.name) && columns.length <= 1,
      onClick: () => patchTable(layerId, { hidden: st.hidden.includes(f.name) ? st.hidden.filter((n) => n !== f.name) : [...st.hidden, f.name] }),
    }));
    items.push('separator', { label: 'Show all fields', disabled: !st.hidden.length, onClick: () => patchTable(layerId, { hidden: [] }) });
    openMenuAt(e.currentTarget, items);
  };

  const total = visibleAll.length;
  const filtered = rows.length !== total;

  return (
    <>
      <div className="pane-toolbar tbl-toolbar">
        <IconButton icon={Plus} title="Add Field" onClick={() => openDialog('table.fields', { layerId, addNew: true })} />
        <IconButton icon={Calculator} title="Calculate Field" onClick={() => openDialog('table.calculate', { layerId })} />
        <IconButton icon={ListTree} title="Fields" onClick={() => openDialog('table.fields', { layerId })} />
        <span className="tbl-sep" />
        <IconButton icon={ListFilter} title="Select By Attributes" onClick={() => openDialog('table.select', { layerId })} />
        <IconButton icon={ZoomIn} title="Zoom To Selection" disabled={!hasSel} onClick={zoomSel} />
        <IconButton icon={ArrowLeftRight} title="Switch Selection" onClick={switchSel} />
        <IconButton icon={Eraser} title="Clear Selection" disabled={!hasSel} onClick={() => clearSelection(layerId)} />
        <IconButton icon={Trash2} title="Delete Selected" disabled={!hasSel || !editable} onClick={deleteSel} />
        <span className="tbl-sep" />
        <IconButton icon={Filter} title="Show selected records only" active={st.selOnly} onClick={() => patchTable(layerId, { selOnly: !st.selOnly })} />
        <IconButton icon={Columns3} title="Show or hide fields" onClick={columnsMenu} />
        <span className="grow" />
        <div className="tbl-search">
          <Search size={13} />
          <input
            className="input"
            value={st.search}
            placeholder="Search all fields"
            spellCheck={false}
            onChange={(e) => patchTable(layerId, { search: e.target.value })}
            onKeyDown={(e) => e.key === 'Escape' && patchTable(layerId, { search: '' })}
          />
          {st.search && (
            <button type="button" className="tbl-search-x" title="Clear search" aria-label="Clear search" onClick={() => patchTable(layerId, { search: '' })}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="tbl-scroll" ref={scrollRef}>
        <div className="tbl-inner" style={{ width: totalWidth, height: HEAD_H + virt.getTotalSize() }}>
          <div className="tbl-head" style={{ width: totalWidth, height: HEAD_H }}>
            <div className="tbl-gutter tbl-hgutter" style={{ width: GUTTER_W }} title={`${ds.fields.length} fields`} />
            {columns.map((f) => {
              const sorted = st.sort?.field === f.name ? st.sort.dir : null;
              return (
                <div
                  key={f.name}
                  className={`tbl-hcell${isNumericType(f.type) ? ' num' : ''}${sorted ? ' sorted' : ''}`}
                  style={{ width: widthOf(f) }}
                  title={`${f.name} · ${TYPE_LABEL[f.type]}${f.alias ? ` · alias "${f.alias}"` : ''}`}
                  onClick={() => cycleSort(f)}
                  onContextMenu={(e) => headerMenu(e, f)}
                >
                  <FieldTypeIcon type={f.type} />
                  <span className="tbl-hlabel">{f.alias || f.name}</span>
                  {sorted === 'asc' && <ArrowUp size={12} className="tbl-sortico" />}
                  {sorted === 'desc' && <ArrowDown size={12} className="tbl-sortico" />}
                  <span className="tbl-resize" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => startResize(e, f)} />
                </div>
              );
            })}
          </div>

          {virt.getVirtualItems().map((vr) => {
            const feat = rows[vr.index];
            if (!feat) return null;
            const selected = selSet.has(feat.id);
            return (
              <div
                key={feat.id}
                className={`tbl-row${selected ? ' sel' : ''}${vr.index % 2 ? ' odd' : ''}`}
                style={{ width: totalWidth, height: ROW_H, transform: `translateY(${vr.start - HEAD_H}px)`, top: HEAD_H }}
              >
                <div
                  className="tbl-gutter"
                  style={{ width: GUTTER_W }}
                  title="Click to select. Ctrl toggles, Shift selects a range. Double-click to zoom."
                  onClick={(e) => onGutterClick(e, vr.index)}
                  onDoubleClick={() => zoomToRow(vr.index)}
                >
                  {vr.index + 1}
                </div>
                {columns.map((f) => (
                  <Cell
                    key={f.name}
                    feat={feat}
                    field={f}
                    width={widthOf(f)}
                    edit={edit && edit.fid === feat.id && edit.field === f.name ? edit : null}
                    onStartEdit={startEdit}
                    onEditText={(text) => setEdit((cur) => (cur ? { ...cur, text } : cur))}
                    onCommit={commitEdit}
                    onCancel={() => {
                      cancelled.current = true;
                      setEdit(null);
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
        {rows.length === 0 && (
          <div className="tbl-none">
            {total === 0 ? 'This table has no records.' : st.selOnly && !hasSel ? 'No records are selected.' : 'No records match the current filter.'}
          </div>
        )}
      </div>

      <div className="pane-footer tbl-footer">
        <span>
          <b>{selection.length.toLocaleString()}</b> of {total.toLocaleString()} selected
        </span>
        <span className="tbl-faint">
          {filtered ? `${rows.length.toLocaleString()} of ${total.toLocaleString()} records shown` : `${total.toLocaleString()} records`}
          {defQuery ? ' · layer definition query active' : ''}
        </span>
        <span className="grow" />
        <span className="tbl-faint tbl-ellipsis">{fl.name}{!editable ? ' · read-only' : ''}</span>
      </div>
    </>
  );
}

// ---------- cell ----------

const Cell = memo(function Cell({
  feat, field, width, edit, onStartEdit, onEditText, onCommit, onCancel,
}: {
  feat: Feat; field: Field; width: number; edit: EditState | null;
  onStartEdit: (f: Feat, field: Field) => void; onEditText: (t: string) => void; onCommit: () => void; onCancel: () => void;
}) {
  const v = feat.properties[field.name];
  const numeric = isNumericType(field.type);
  if (edit) {
    return (
      <div className="tbl-cell editing" style={{ width }}>
        <input
          className="tbl-edit"
          autoFocus
          value={edit.text}
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onEditText(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit();
            else if (e.key === 'Escape') onCancel();
            e.stopPropagation();
          }}
        />
      </div>
    );
  }
  const isNull = v === null || v === undefined;
  return (
    <div className={`tbl-cell${numeric ? ' num' : ''}${isNull ? ' null' : ''}`} style={{ width }} onDoubleClick={() => onStartEdit(feat, field)}>
      {isNull ? '<Null>' : formatCell(v, field.type)}
    </div>
  );
});
