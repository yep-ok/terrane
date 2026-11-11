import {
  memo, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent as RMouseEvent,
} from 'react';
import {
  ChevronDown, ChevronRight, Database, Folder, FolderOpen, Globe, Hexagon, Image as ImageIcon, ListOrdered, Map as MapIcon,
  MapPin, Pencil, Plus, Spline, SquareMousePointer, Table2, type LucideIcon,
} from 'lucide-react';
import type { Dataset, FeatureLayer, Id, Layer } from '../../core/types';
import { useDataset } from '../../core/data';
import { getMap, updateLayer, updateMap, useProject } from '../../core/store';
import {
  clearSelection, setActiveLayer, showContextMenu, useActiveLayerId, useActiveMapId, useSelection, useUi,
} from '../../core/ui';
import { getCommand, runCommand } from '../../core/registry';
import { getBasemap } from '../../core/basemaps';
import { cx, Button, Empty, IconButton } from '../../ui/kit';
import { SymbolSwatch, legendFor } from '../symbology/legend';
import { ancestorsVisible, inZoomRange, planIsNoop, resolveDrop, visibleRows, type DropZone } from './tree';
import { cui, cuiGet, rowOrder, startRename, stopRename, toggleLegend, useContentsUi, type ContentsMode } from './state';
import { applyPlan, removeLayers, setVisible, targetIds } from './actions';
import { layerMenu, mapMenu } from './menus';
import { openDialog } from '../../core/ui';

const EMPTY_LAYERS: Layer[] = [];
const INDENT = 14;
const MAX_LEGEND_ITEMS = 40;

const MODES: Array<{ id: ContentsMode; title: string; icon: LucideIcon }> = [
  { id: 'order', title: 'List by drawing order', icon: ListOrdered },
  { id: 'source', title: 'List by data source', icon: Database },
  { id: 'selection', title: 'List by selection', icon: SquareMousePointer },
  { id: 'editing', title: 'List by editing', icon: Pencil },
];

// ---------- inline editing ----------

function InlineEdit({ value, onCommit, onCancel, className }: { value: string; onCommit: (v: string) => void; onCancel: () => void; className?: string }) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const t = text.trim();
    if (commit && t && t !== value) onCommit(t);
    else onCancel();
  };
  return (
    <input
      ref={ref}
      className={cx('ct-edit', className)}
      value={text}
      spellCheck={false}
      draggable={false}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDragStart={(e) => e.preventDefault()}
    />
  );
}

// ---------- selection handling ----------

let renameTimer: ReturnType<typeof setTimeout> | undefined;
const cancelRenameTimer = () => {
  if (renameTimer) clearTimeout(renameTimer);
  renameTimer = undefined;
};

function clickLayer(layer: Layer, e: RMouseEvent, onName: boolean) {
  cancelRenameTimer();
  const { multi, anchor } = cuiGet();
  const active = useUi.getState().activeLayerId;
  if (e.ctrlKey || e.metaKey) {
    const has = multi.includes(layer.id);
    const next = has ? multi.filter((x) => x !== layer.id) : [...multi, layer.id];
    cui({ multi: next, anchor: layer.id });
    setActiveLayer(has ? (active === layer.id ? next[next.length - 1] ?? null : active) : layer.id);
    return;
  }
  if (e.shiftKey && anchor) {
    const ids = rowOrder.ids;
    const a = ids.indexOf(anchor);
    const b = ids.indexOf(layer.id);
    if (a >= 0 && b >= 0) {
      cui({ multi: ids.slice(Math.min(a, b), Math.max(a, b) + 1) });
      setActiveLayer(layer.id);
      return;
    }
  }
  const wasOnlyActive = active === layer.id && multi.length <= 1;
  cui({ multi: [layer.id], anchor: layer.id });
  setActiveLayer(layer.id);
  // Slow second click on the selected layer's name starts renaming (like a file manager).
  if (wasOnlyActive && onName)
    renameTimer = setTimeout(() => {
      renameTimer = undefined;
      startRename(layer.id);
    }, 650);
}

// ---------- drag and drop ----------

function pickZone(layerId: Id, rect: DOMRect, clientY: number): DropZone {
  const l = getMap(useUi.getState().activeMapId)?.layers.find((x) => x.id === layerId);
  const y = clientY - rect.top;
  const h = rect.height;
  if (l?.kind === 'group') {
    const open = l.expanded !== false && !!getMap(useUi.getState().activeMapId)?.layers.some((x) => x.parentId === l.id);
    if (y < 7) return 'before';
    if (y > h - 7 && !open) return 'after';
    return 'inside';
  }
  return y < h / 2 ? 'before' : 'after';
}

function onItemDragOver(e: DragEvent<HTMLDivElement>, layer: Layer) {
  const { dragId, drop } = cuiGet();
  if (!dragId) return;
  const mapId = useUi.getState().activeMapId;
  const layers = getMap(mapId)?.layers;
  const zone = pickZone(layer.id, e.currentTarget.getBoundingClientRect(), e.clientY);
  const plan = layers ? resolveDrop(layers, dragId, layer.id, zone) : null;
  if (!layers || !plan || planIsNoop(layers, plan)) {
    if (drop) cui({ drop: null });
    return;
  }
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (drop?.targetId !== layer.id || drop.zone !== zone) cui({ drop: { targetId: layer.id, zone } });
}

function commitDrop(e: DragEvent, targetId: Id | null) {
  const { dragId, drop } = cuiGet();
  const mapId = useUi.getState().activeMapId;
  cui({ dragId: null, drop: null });
  if (!dragId || !mapId || !drop) return;
  e.preventDefault();
  const layers = getMap(mapId)?.layers;
  const plan = layers && resolveDrop(layers, dragId, targetId, drop.zone);
  if (plan) {
    applyPlan(mapId, plan);
    if (drop.zone === 'inside' && targetId) updateLayer(targetId, { expanded: true });
  }
}

// ---------- legend ----------

const GEOM_WORD = { Point: 'Points', LineString: 'Lines', Polygon: 'Polygons' } as const;

function Legend({ layer, ds, depth }: { layer: FeatureLayer; ds: Dataset | undefined; depth: number }) {
  const legend = useMemo(() => legendFor(layer, ds), [layer, ds]);
  const geom = ds?.geomType ?? null;
  const edit = () => {
    setActiveLayer(layer.id);
    cui({ multi: [layer.id], anchor: layer.id });
    if (getCommand('layer.symbology')) void runCommand('layer.symbology', layer.id);
  };
  const style: CSSProperties = { paddingLeft: depth * INDENT + 38 };
  if (legend.gradient) {
    return (
      <div className="ct-legend" style={style}>
        {legend.heading && <div className="ct-legend-head">{legend.heading}</div>}
        <button type="button" className="ct-gradient" onClick={edit} title="Edit symbology" style={{ background: `linear-gradient(to right, ${legend.gradient.join(', ')})` }} />
        <div className="ct-gradient-labels"><span>Low</span><span>High</span></div>
      </div>
    );
  }
  const shown = legend.items.slice(0, MAX_LEGEND_ITEMS);
  const single = !legend.heading && legend.items.length === 1;
  return (
    <div className="ct-legend" style={style}>
      {legend.heading && <div className="ct-legend-head" title={legend.heading}>{legend.heading}</div>}
      {shown.map((it, i) => (
        <button key={i} type="button" className="ct-legend-item" onClick={edit} title="Edit symbology">
          <SymbolSwatch symbol={it.symbol} geomType={geom} />
          <span className="ct-legend-label">{it.label || (single && geom ? GEOM_WORD[geom] : '')}</span>
        </button>
      ))}
      {legend.items.length > shown.length && <div className="ct-legend-more">… {legend.items.length - shown.length} more</div>}
    </div>
  );
}

// ---------- layer item ----------

function typeIcon(layer: Layer, ds: Dataset | undefined): LucideIcon {
  switch (layer.kind) {
    case 'group': return layer.expanded ? FolderOpen : Folder;
    case 'tile': return Globe;
    case 'raster': return ImageIcon;
    default:
      return ds?.geomType === 'Point' ? MapPin : ds?.geomType === 'LineString' ? Spline : ds?.geomType === 'Polygon' ? Hexagon : Table2;
  }
}

interface ItemProps {
  layer: Layer;
  depth: number;
  mode: ContentsMode;
  active: boolean;
  selected: boolean;
  dim: '' | 'ancestor' | 'zoom';
}

const LayerItem = memo(function LayerItem({ layer, depth, mode, active, selected, dim }: ItemProps) {
  const ds = useDataset(layer.kind === 'feature' ? layer.datasetId : null);
  const selCount = useSelection(layer.kind === 'feature' ? layer.id : null).length;
  const renaming = useContentsUi((s) => s.renamingId === layer.id);
  const legendCollapsed = useContentsUi((s) => !!s.collapsedLegends[layer.id]);
  const dropZone = useContentsUi((s) => (s.drop && s.drop.targetId === layer.id ? s.drop.zone : null));
  const dragging = useContentsUi((s) => s.dragId === layer.id);
  const Icon = typeIcon(layer, ds);
  const feature = layer.kind === 'feature' ? layer : null;
  const hasLegend = !!feature && !!ds && ds.geomType !== null && mode !== 'selection' && mode !== 'editing';
  const draggable = mode === 'order' && !renaming;

  let checked = layer.visible;
  let checkTitle = layer.visible ? 'Hide layer' : 'Show layer';
  if (mode === 'selection' && feature) {
    checked = feature.selectable;
    checkTitle = feature.selectable ? 'Selectable (click to lock)' : 'Not selectable (click to allow)';
  } else if (mode === 'editing' && feature) {
    checked = feature.editable;
    checkTitle = feature.editable ? 'Editable (click to lock)' : 'Not editable (click to allow)';
  }
  const rowTitle =
    dim === 'ancestor' ? `${layer.name} (hidden by a group layer)`
    : dim === 'zoom' ? `${layer.name} (not drawn at this zoom level)`
    : layer.name;

  const onCheck = (v: boolean) => {
    const { multi } = cuiGet();
    const ids = multi.length > 1 && multi.includes(layer.id) ? multi : [layer.id];
    if (mode === 'selection' && feature) ids.forEach((id) => updateLayer(id, { selectable: v }));
    else if (mode === 'editing' && feature) ids.forEach((id) => updateLayer(id, { editable: v }));
    else setVisible(ids, v);
  };

  const countText = ds ? ds.features.length.toLocaleString() : '';

  return (
    <div
      className={cx('ct-item', dropZone && `drop-${dropZone}`, dragging && 'dragging')}
      style={{ '--ct-depth': depth } as CSSProperties}
      draggable={draggable}
      onDragStart={(e) => {
        cancelRenameTimer();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', layer.name);
        requestAnimationFrame(() => cui({ dragId: layer.id }));
      }}
      onDragEnd={() => cui({ dragId: null, drop: null })}
      onDragOver={(e) => onItemDragOver(e, layer)}
      onDrop={(e) => commitDrop(e, layer.id)}
    >
      <div
        className={cx('ct-row', active && 'active', selected && !active && 'selected', dim && 'dim')}
        title={rowTitle}
        data-layer-id={layer.id}
        onClick={(e) => clickLayer(layer, e, (e.target as HTMLElement).closest('.ct-name') !== null)}
        onDoubleClick={(e) => {
          cancelRenameTimer();
          if ((e.target as HTMLElement).closest('input,button')) return;
          if (layer.kind === 'group') updateLayer(layer.id, { expanded: !layer.expanded });
          else void runCommand('layer.properties', layer.id);
        }}
        onContextMenu={(e) => {
          const { multi } = cuiGet();
          if (!multi.includes(layer.id) || multi.length < 2) {
            cui({ multi: [layer.id], anchor: layer.id });
            setActiveLayer(layer.id);
          }
          showContextMenu(e, layerMenu(layer));
        }}
      >
        <span style={{ width: depth * INDENT, flex: 'none' }} />
        {layer.kind === 'group' || hasLegend ? (
          <button
            type="button"
            className="ct-chev"
            aria-label={layer.kind === 'group' ? (layer.expanded ? 'Collapse group' : 'Expand group') : legendCollapsed ? 'Show legend' : 'Hide legend'}
            onClick={(e) => {
              e.stopPropagation();
              if (layer.kind === 'group') updateLayer(layer.id, { expanded: !layer.expanded });
              else toggleLegend(layer.id);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {(layer.kind === 'group' ? layer.expanded : !legendCollapsed) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="ct-chev" />
        )}
        {(mode === 'selection' || mode === 'editing') && !feature ? (
          <span className="ct-check-spacer" />
        ) : (
          <input
            type="checkbox"
            className={cx('ct-check', mode !== 'order' && mode !== 'source' && 'mode')}
            checked={checked}
            title={checkTitle}
            onChange={(e) => onCheck(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        )}
        <Icon className="ct-icon" size={14} />
        {renaming ? (
          <InlineEdit value={layer.name} onCommit={(v) => { updateLayer(layer.id, { name: v }); stopRename(); }} onCancel={stopRename} />
        ) : (
          <span className="ct-name">{layer.name}</span>
        )}
        {selCount > 0 && <span className="ct-badge" title={`${selCount.toLocaleString()} selected`}>{selCount.toLocaleString()}</span>}
        {countText && !renaming && <span className="ct-count">{countText}</span>}
      </div>
      {hasLegend && !legendCollapsed && feature && <Legend layer={feature} ds={ds} depth={depth} />}
    </div>
  );
});

function SourceHeader({ datasetId, title, count }: { datasetId?: Id; title: string; count: number }) {
  const ds = useDataset(datasetId);
  return (
    <div className="ct-source-head" title={ds?.source ?? title}>
      <Database size={13} />
      <span className="ct-name">{ds?.name ?? title}</span>
      <span className="ct-count">{ds ? `${ds.features.length.toLocaleString()} features` : `${count} layer${count === 1 ? '' : 's'}`}</span>
    </div>
  );
}

// ---------- map header ----------

function MapHeader({ mapId, name }: { mapId: Id; name: string }) {
  const renaming = useContentsUi((s) => s.renamingMap);
  const mode = useContentsUi((s) => s.mode);
  return (
    <div className="ct-header" onContextMenu={(e) => showContextMenu(e, mapMenu(mapId, { header: true }))}>
      <MapIcon size={15} className="ct-mapicon" />
      {renaming ? (
        <InlineEdit className="ct-mapedit" value={name} onCommit={(v) => { updateMap(mapId, { name: v }); stopRename(); }} onCancel={stopRename} />
      ) : (
        <span className="ct-mapname" title={`${name} — double-click to rename`} onDoubleClick={() => cui({ renamingMap: true, renamingId: null })}>{name}</span>
      )}
      <div className="ct-modes">
        {MODES.map((m) => (
          <IconButton key={m.id} icon={m.icon} title={m.title} active={mode === m.id} onClick={() => cui({ mode: m.id })} />
        ))}
      </div>
    </div>
  );
}

// ---------- pane ----------

type Entry =
  | { type: 'layer'; layer: Layer; depth: number }
  | { type: 'header'; key: string; datasetId?: Id; title: string; count: number };

function buildEntries(layers: Layer[], mode: ContentsMode): Entry[] {
  if (mode === 'order') return visibleRows(layers).map((r) => ({ type: 'layer', layer: r.layer, depth: r.depth }));
  const ordered = visibleRows(layers, () => true).map((r) => r.layer);
  if (mode === 'selection' || mode === 'editing')
    return ordered.filter((l) => l.kind === 'feature').map((layer) => ({ type: 'layer', layer, depth: 0 }));
  // by data source
  const out: Entry[] = [];
  const byDs = new Map<Id, Layer[]>();
  const other: Layer[] = [];
  for (const l of ordered) {
    if (l.kind === 'feature') byDs.set(l.datasetId, [...(byDs.get(l.datasetId) ?? []), l]);
    else if (l.kind !== 'group') other.push(l);
  }
  for (const [datasetId, ls] of byDs) {
    out.push({ type: 'header', key: `ds:${datasetId}`, datasetId, title: 'Dataset', count: ls.length });
    ls.forEach((layer) => out.push({ type: 'layer', layer, depth: 1 }));
  }
  if (other.length) {
    out.push({ type: 'header', key: 'other', title: 'Web & raster layers', count: other.length });
    other.forEach((layer) => out.push({ type: 'layer', layer, depth: 1 }));
  }
  return out;
}

function ContentsBody({ mapId }: { mapId: Id }) {
  const layers = useProject((s) => s.project.maps.find((m) => m.id === mapId)?.layers) ?? EMPTY_LAYERS;
  const name = useProject((s) => s.project.maps.find((m) => m.id === mapId)?.name) ?? '';
  const basemap = useProject((s) => s.project.maps.find((m) => m.id === mapId)?.basemap) ?? null;
  // Rounded so panning (which replaces map.view) never re-renders the tree.
  const zoom = useProject((s) => Math.round((s.project.maps.find((m) => m.id === mapId)?.view.zoom ?? 0) * 10) / 10);
  const mode = useContentsUi((s) => s.mode);
  const multi = useContentsUi((s) => s.multi);
  const activeId = useActiveLayerId();
  const totalSelected = useUi((s) => Object.values(s.selection).reduce((n, a) => n + a.length, 0));
  const entries = useMemo(() => buildEntries(layers, mode), [layers, mode]);
  const dragActive = useContentsUi((s) => s.dragId !== null && s.drop?.targetId === null && s.drop.zone === 'end');

  rowOrder.ids = entries.flatMap((e) => (e.type === 'layer' ? [e.layer.id] : []));

  useEffect(() => cancelRenameTimer, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text') return;
    const ids = rowOrder.ids;
    if (e.key === 'F2') {
      const id = targetIds()[0];
      if (id) {
        e.preventDefault();
        startRename(id);
      }
    } else if (e.key === 'Delete') {
      const sel = targetIds();
      if (sel.length) {
        e.preventDefault();
        removeLayers(sel);
      }
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && ids.length) {
      e.preventDefault();
      const i = activeId ? ids.indexOf(activeId) : -1;
      const next = ids[Math.max(0, Math.min(ids.length - 1, i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1)))];
      setActiveLayer(next);
      cui({ multi: [next], anchor: next });
    } else if (e.key === ' ' && t.tagName !== 'INPUT' && activeId) {
      e.preventDefault();
      void runCommand('layer.toggleVisibility');
    }
  };

  const dimOf = (l: Layer): '' | 'ancestor' | 'zoom' =>
    !ancestorsVisible(layers, l.id) ? 'ancestor' : l.kind !== 'group' && !inZoomRange(l, zoom) ? 'zoom' : '';

  const bm = getBasemap(basemap);
  const multiSet = new Set(multi.length > 1 ? multi : []);

  return (
    <div className="ct-pane" tabIndex={0} onKeyDown={onKeyDown} onDragLeave={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) cui({ drop: null });
    }}>
      <MapHeader mapId={mapId} name={name} />
      {mode === 'selection' && (
        <div className="ct-subbar">
          <span className="muted">{totalSelected.toLocaleString()} feature{totalSelected === 1 ? '' : 's'} selected</span>
          <span className="grow" />
          <Button variant="ghost" disabled={!totalSelected} onClick={() => clearSelection()}>Clear</Button>
        </div>
      )}
      {mode === 'editing' && <div className="ct-subbar muted">Tick the layers that can be edited.</div>}
      <div className="ct-list pane-body">
        {entries.map((en) =>
          en.type === 'header' ? (
            <SourceHeader key={en.key} datasetId={en.datasetId} title={en.title} count={en.count} />
          ) : (
            <LayerItem
              key={en.layer.id}
              layer={en.layer}
              depth={en.depth}
              mode={mode}
              active={activeId === en.layer.id}
              selected={multiSet.has(en.layer.id)}
              dim={dimOf(en.layer)}
            />
          ),
        )}
        <div
          className={cx('ct-fill', dragActive && 'drop-end')}
          onClick={() => cui({ multi: activeId ? [activeId] : [] })}
          onContextMenu={(e) => showContextMenu(e, mapMenu(mapId))}
          onDragOver={(e) => {
            const { dragId, drop } = cuiGet();
            if (!dragId || mode !== 'order') return;
            const ls = getMap(mapId)?.layers;
            const plan = ls && resolveDrop(ls, dragId, null, 'end');
            if (!ls || !plan || planIsNoop(ls, plan)) return;
            e.preventDefault();
            if (!(drop && drop.targetId === null)) cui({ drop: { targetId: null, zone: 'end' } });
          }}
          onDrop={(e) => commitDrop(e, null)}
        >
          {!layers.length && (
            <Empty icon={Plus} title="No layers yet">
              <span>Add data to start building this map.</span>
              {getCommand('data.add') && <Button variant="primary" onClick={() => void runCommand('data.add')}>Add Data…</Button>}
            </Empty>
          )}
          {layers.length > 0 && !entries.length && <div className="ct-note">No feature layers in this map.</div>}
        </div>
      </div>
      <button
        type="button"
        className="ct-basemap"
        title="Change basemap"
        onClick={() => (getCommand('map.basemap') ? void runCommand('map.basemap') : openDialog('map-properties', { mapId }))}
      >
        <Globe size={14} />
        <span className="muted">Basemap</span>
        <span className="ct-name">{bm?.name ?? 'None'}</span>
      </button>
    </div>
  );
}

export function ContentsPane() {
  const mapId = useActiveMapId();
  const exists = useProject((s) => !!mapId && s.project.maps.some((m) => m.id === mapId));
  const prev = useRef(mapId);
  useEffect(() => {
    // Drop per-map UI leftovers when the active map changes (not on first mount: commands may have queued a rename).
    if (prev.current !== mapId) cui({ multi: [], anchor: null, renamingId: null, renamingMap: false, drop: null, dragId: null });
    prev.current = mapId;
  }, [mapId]);
  if (!mapId || !exists)
    return (
      <Empty icon={MapIcon} title="No map open">
        <span>Create a map to see its layers here.</span>
        {getCommand('map.new') && <Button variant="primary" onClick={() => void runCommand('map.new')}>New Map</Button>}
      </Empty>
    );
  return <ContentsBody key={mapId} mapId={mapId} />;
}
