import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Palette, Tag } from 'lucide-react';
import type { Dataset, FeatureLayer, Id, Layer, MapDoc } from '../../core/types';
import { datasetExtent, getBlob, getDataset, useDataset, useDatasetVersion } from '../../core/data';
import { compileWhere, tryCompile } from '../../core/expr';
import { crsName } from '../../core/crs';
import { BASEMAPS } from '../../core/basemaps';
import { fieldRef, findLayer, getMap, setView, updateLayer, updateMap, useLayer, useMapDoc } from '../../core/store';
import { isLayerVisible } from '../../core/store';
import { useUi } from '../../core/ui';
import { getCommand, runCommand } from '../../core/registry';
import { getMapHandle } from '../../map/handle';
import { Button, Checkbox, IconButton, NumberInput, Row, Section, Select, Slider, Tabs, TextInput, useDebounced } from '../../ui/kit';

// ---------- shared ----------

function Footer({ onOk, onCancel, onApply, dirty, canOk = true }: { onOk: () => void; onCancel: () => void; onApply: () => void; dirty: boolean; canOk?: boolean }) {
  return (
    <div className="dialog-footer">
      <Button variant="primary" disabled={!canOk} onClick={onOk}>OK</Button>
      <Button onClick={onCancel}>Cancel</Button>
      <Button disabled={!dirty || !canOk} onClick={onApply}>Apply</Button>
    </div>
  );
}

function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <div className="ct-k">{k}</div>
      <div className="ct-v selectable">{children}</div>
    </>
  );
}

const fmtExtent = (e: [number, number, number, number] | null) =>
  e ? `${e[0].toFixed(4)}, ${e[1].toFixed(4)}  to  ${e[2].toFixed(4)}, ${e[3].toFixed(4)}` : 'No spatial extent';

// ---------- confirm ----------

export function ConfirmDialog({ props, close }: { props: { message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void }; close: () => void }) {
  return (
    <>
      <div className="dialog-body"><p style={{ margin: 0, lineHeight: 1.5 }}>{props.message}</p></div>
      <div className="dialog-footer">
        <Button variant={props.danger ? 'danger' : 'primary'} onClick={() => { close(); props.onConfirm(); }}>{props.confirmLabel ?? 'OK'}</Button>
        <Button onClick={close}>Cancel</Button>
      </div>
    </>
  );
}

// ---------- layer properties ----------

interface Draft {
  name: string;
  visible: boolean;
  opacity: number;
  minZoom?: number;
  maxZoom?: number;
  selectable: boolean;
  editable: boolean;
  query: string;
  popupTitle: string;
  popupOrder: string[];
  popupOn: string[];
}

function makeDraft(layer: Layer, ds: Dataset | undefined): Draft {
  const names = ds?.fields.map((f) => f.name) ?? [];
  const shown = layer.kind === 'feature' ? layer.popup?.fields : undefined;
  const popupOrder = shown ? [...shown.filter((n) => names.includes(n)), ...names.filter((n) => !shown.includes(n))] : names;
  return {
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    minZoom: layer.minZoom,
    maxZoom: layer.maxZoom,
    selectable: layer.kind === 'feature' ? layer.selectable : false,
    editable: layer.kind === 'feature' ? layer.editable : false,
    query: layer.kind === 'feature' ? layer.definitionQuery ?? '' : '',
    popupTitle: layer.kind === 'feature' ? layer.popup?.title ?? '' : '',
    popupOrder,
    popupOn: shown ? shown.filter((n) => names.includes(n)) : names,
  };
}

type TabId = 'general' | 'source' | 'query' | 'selection' | 'popups';

export function LayerPropertiesDialog({ props, close }: { props: { layerId: Id; tab?: TabId }; close: () => void }) {
  const layer = useLayer(props.layerId);
  if (!layer)
    return (
      <>
        <div className="dialog-body muted">This layer no longer exists.</div>
        <div className="dialog-footer"><Button onClick={close}>Close</Button></div>
      </>
    );
  return <LayerEditor layer={layer} initialTab={props.tab} close={close} />;
}

function LayerEditor({ layer, initialTab, close }: { layer: Layer; initialTab?: TabId; close: () => void }) {
  const feature = layer.kind === 'feature' ? layer : null;
  const ds = useDataset(feature?.datasetId);
  const mapId = findLayer(layer.id)?.map.id;
  const [base, setBase] = useState(() => makeDraft(layer, ds));
  const [draft, setDraft] = useState(base);
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'general', label: 'General' },
    { id: 'source', label: 'Source' },
    ...(feature
      ? ([
          { id: 'query', label: 'Definition Query' },
          { id: 'selection', label: 'Selection & Editing' },
          { id: 'popups', label: 'Pop-ups' },
        ] as Array<{ id: TabId; label: string }>)
      : []),
  ];
  const [tab, setTab] = useState<TabId>(initialTab && tabs.some((t) => t.id === initialTab) ? initialTab : 'general');
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const nameOk = draft.name.trim().length > 0;

  const apply = () => {
    const patch: Record<string, any> = { name: draft.name.trim(), visible: draft.visible };
    if (layer.kind !== 'group') Object.assign(patch, { opacity: draft.opacity, minZoom: draft.minZoom, maxZoom: draft.maxZoom });
    if (feature) {
      const names = ds?.fields.map((f) => f.name) ?? [];
      const ordered = draft.popupOrder.filter((n) => draft.popupOn.includes(n));
      const allDefault = ordered.length === names.length && ordered.every((n, i) => n === names[i]);
      const popup: FeatureLayer['popup'] = {};
      if (draft.popupTitle.trim()) popup.title = draft.popupTitle.trim();
      if (!allDefault) popup.fields = ordered;
      Object.assign(patch, {
        selectable: draft.selectable,
        editable: draft.editable,
        definitionQuery: draft.query.trim() || undefined,
        popup: popup.title || popup.fields ? popup : undefined,
      });
    }
    updateLayer(layer.id, patch);
    setBase(draft);
  };

  return (
    <>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="dialog-body ct-dlg-body">
        {tab === 'general' && <GeneralTab layer={layer} mapId={mapId} draft={draft} set={set} />}
        {tab === 'source' && <SourceTab layer={layer} ds={ds} mapId={mapId} />}
        {tab === 'query' && feature && <QueryTab ds={ds} draft={draft} set={set} onApply={apply} />}
        {tab === 'selection' && feature && (
          <div className="vstack">
            <Checkbox checked={draft.selectable} onChange={(v) => set({ selectable: v })} label="Features can be selected on the map" />
            <Checkbox checked={draft.editable} onChange={(v) => set({ editable: v })} label="Features can be edited" />
            <div className="hint muted">Turn off selection to keep a reference layer from catching clicks and selection rectangles. Edit tools only change editable layers.</div>
          </div>
        )}
        {tab === 'popups' && feature && <PopupTab ds={ds} draft={draft} set={set} />}
      </div>
      <Footer
        dirty={dirty}
        canOk={nameOk}
        onApply={apply}
        onCancel={close}
        onOk={() => {
          if (dirty) apply();
          close();
        }}
      />
    </>
  );
}

function GeneralTab({ layer, mapId, draft, set }: { layer: Layer; mapId?: Id; draft: Draft; set: (p: Partial<Draft>) => void }) {
  const zoom = mapId ? getMap(mapId)?.view.zoom ?? 0 : 0;
  const cur = Math.round(zoom * 10) / 10;
  const feature = layer.kind === 'feature';
  return (
    <div>
      <Row label="Name"><TextInput value={draft.name} onChange={(v) => set({ name: v })} invalid={!draft.name.trim()} autoFocus /></Row>
      <Row label="Visibility"><Checkbox checked={draft.visible} onChange={(v) => set({ visible: v })} label="Draw this layer" /></Row>
      {layer.kind !== 'group' && (
        <>
          <Row label="Opacity"><Slider value={draft.opacity} onChange={(v) => set({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} /></Row>
          <Row label="Min zoom" hint="Hidden when zoomed out beyond this level.">
            <NumberInput value={draft.minZoom} min={0} max={24} step={0.5} placeholder="None" onChange={(v) => set({ minZoom: v })} />
            <Button onClick={() => set({ minZoom: cur })} title="Use the map's current zoom level">Use {cur}</Button>
            <Button variant="ghost" disabled={draft.minZoom === undefined} onClick={() => set({ minZoom: undefined })}>Clear</Button>
          </Row>
          <Row label="Max zoom" hint="Hidden when zoomed in beyond this level.">
            <NumberInput value={draft.maxZoom} min={0} max={24} step={0.5} placeholder="None" onChange={(v) => set({ maxZoom: v })} />
            <Button onClick={() => set({ maxZoom: cur })} title="Use the map's current zoom level">Use {cur}</Button>
            <Button variant="ghost" disabled={draft.maxZoom === undefined} onClick={() => set({ maxZoom: undefined })}>Clear</Button>
          </Row>
        </>
      )}
      {feature && (
        <Row label="Appearance">
          {getCommand('layer.symbology') && <Button icon={Palette} onClick={() => void runCommand('layer.symbology', layer.id)}>Symbology…</Button>}
          {getCommand('layer.labeling') && <Button icon={Tag} onClick={() => void runCommand('layer.labeling', layer.id)}>Labeling…</Button>}
        </Row>
      )}
    </div>
  );
}

function SourceTab({ layer, ds, mapId }: { layer: Layer; ds?: Dataset; mapId?: Id }) {
  const version = useDatasetVersion(layer.kind === 'feature' ? layer.datasetId : null);
  const extent = useMemo(() => (layer.kind === 'feature' ? datasetExtent(layer.datasetId) : null), [layer, version]);
  const map = useMapDoc(mapId);
  if (layer.kind === 'group') {
    const kids = (map?.layers ?? []).filter((l) => l.parentId === layer.id).length;
    return <div className="ct-kv"><KV k="Type">Group layer</KV><KV k="Contains">{kids} layer{kids === 1 ? '' : 's'}</KV></div>;
  }
  if (layer.kind === 'tile') {
    const s = layer.source;
    return (
      <div className="ct-kv">
        <KV k="Type">Web tile layer ({s.type.toUpperCase()})</KV>
        <KV k="URL"><span className="ct-wrap">{s.url}</span></KV>
        {s.type === 'wms' && <KV k="WMS layers">{s.layers}</KV>}
        {s.type === 'wmts' && <KV k="WMTS layer">{s.layer}{s.matrixSet ? ` (${s.matrixSet})` : ''}</KV>}
        {s.attribution && <KV k="Attribution"><span className="ct-wrap">{s.attribution.replace(/<[^>]+>/g, '')}</span></KV>}
      </div>
    );
  }
  if (layer.kind === 'raster') {
    const blob = getBlob(layer.blobId);
    return (
      <div className="ct-kv">
        <KV k="Type">Raster layer</KV>
        {blob && <KV k="File type">{blob.type || 'unknown'}</KV>}
        {blob && <KV k="File size">{blob.size >= 1048576 ? `${(blob.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(blob.size / 1024))} KB`}</KV>}
        {layer.url && <KV k="URL"><span className="ct-wrap">{layer.url}</span></KV>}
        {!blob && !layer.url && <KV k="Data">Not available in this session</KV>}
      </div>
    );
  }
  if (!ds) return <div className="muted">The dataset for this layer is missing.</div>;
  return (
    <div>
      <div className="ct-kv">
        <KV k="Dataset">{ds.name}</KV>
        <KV k="Source">{ds.source ?? 'Created in this project'}</KV>
        <KV k="Geometry">{ds.geomType === 'LineString' ? 'Line' : ds.geomType ?? 'Table (no geometry)'}</KV>
        <KV k="Features">{ds.features.length.toLocaleString()}</KV>
        <KV k="Extent (lon/lat)">{fmtExtent(extent)}</KV>
        <KV k="Coordinate system">Stored as WGS 1984 (EPSG:4326); drawn in {crsName(map?.crs ?? 'EPSG:3857')}</KV>
      </div>
      <div className="ct-subtitle">Fields ({ds.fields.length})</div>
      <div className="ct-fields">
        <table>
          <thead><tr><th>Name</th><th>Alias</th><th>Type</th></tr></thead>
          <tbody>
            {ds.fields.map((f) => (
              <tr key={f.name}><td>{f.name}</td><td className="muted">{f.alias ?? ''}</td><td className="muted">{f.type}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const OPERATORS = ['=', '<>', '>', '<', '>=', '<=', 'AND', 'OR', 'NOT', 'LIKE', 'IS NULL', '( )'];

function QueryTab({ ds, draft, set, onApply }: { ds?: Dataset; draft: Draft; set: (p: Partial<Draft>) => void; onApply: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const version = useDatasetVersion(ds?.id);
  const debounced = useDebounced(draft.query, 250);
  const insert = (text: string) => {
    const el = ref.current;
    const q = draft.query;
    const a = el?.selectionStart ?? q.length;
    const b = el?.selectionEnd ?? q.length;
    const inserted = text === '( )' ? `(${q.slice(a, b)})` : text;
    const padL = a > 0 && !/[\s(]$/.test(q.slice(0, a)) && /^[A-Za-z=<>]/.test(inserted) ? ' ' : '';
    const next = `${q.slice(0, a)}${padL}${inserted}${/^[A-Za-z]/.test(inserted) && text !== '( )' ? ' ' : ''}${q.slice(b)}`;
    set({ query: next });
    const pos = a + padL.length + inserted.length + (/^[A-Za-z]/.test(inserted) && text !== '( )' ? 1 : 0);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(text === '( )' ? a + 1 + padL.length : pos, text === '( )' ? a + 1 + padL.length + (b - a) : pos);
    });
  };
  const check = useMemo(() => (debounced.trim() ? tryCompile(debounced) : {}), [debounced]);
  const matches = useMemo(() => {
    if (!ds || !debounced.trim() || check.error) return null;
    try {
      const pred = compileWhere(debounced);
      let n = 0;
      for (const f of ds.features) if (pred(f)) n++;
      return n;
    } catch {
      return null;
    }
  }, [ds, debounced, check.error, version]);
  const error = check.error;
  return (
    <div className="vstack">
      <div className="muted">Only features matching this where-clause are drawn and listed.</div>
      <div className="hstack">
        <div className="grow">
          <Select
            value=""
            placeholder="Insert field…"
            onChange={(f) => insert(fieldRef(f))}
            options={(ds?.fields ?? []).map((f) => ({ value: f.name, label: `${f.name}  (${f.type})` }))}
          />
        </div>
      </div>
      <div className="ct-ops">
        {OPERATORS.map((o) => <button key={o} type="button" className="btn" onClick={() => insert(o)}>{o}</button>)}
      </div>
      <textarea
        ref={ref}
        className={`textarea${error ? ' invalid' : ''}`}
        rows={6}
        spellCheck={false}
        value={draft.query}
        placeholder={"e.g.  POP > 1000000 AND NAME LIKE 'A%'"}
        onChange={(e) => set({ query: e.target.value })}
      />
      <div className="hstack">
        <div className="grow">
          {error ? <span className="error-text">{error}</span>
            : !debounced.trim() ? <span className="muted">No query: all {ds?.features.length.toLocaleString() ?? 0} features are shown.</span>
            : matches !== null ? <span>{matches.toLocaleString()} of {ds?.features.length.toLocaleString()} features match.</span>
            : <span className="muted">Expression is valid.</span>}
        </div>
        <Button variant="ghost" disabled={!draft.query} onClick={() => set({ query: '' })}>Clear</Button>
        <Button disabled={!!error} onClick={onApply}>Apply</Button>
      </div>
    </div>
  );
}

function PopupTab({ ds, draft, set }: { ds?: Dataset; draft: Draft; set: (p: Partial<Draft>) => void }) {
  const titleErr = draft.popupTitle.trim() ? tryCompile(draft.popupTitle).error : undefined;
  const move = (i: number, d: number) => {
    const next = [...draft.popupOrder];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    set({ popupOrder: next });
  };
  const toggle = (name: string, on: boolean) => set({ popupOn: on ? [...draft.popupOn, name] : draft.popupOn.filter((n) => n !== name) });
  const types = new Map((ds?.fields ?? []).map((f) => [f.name, f.type]));
  return (
    <div className="vstack">
      <Row label="Title" stacked hint={titleErr ? <span className="error-text">{titleErr}</span> : 'Expression for the pop-up heading, e.g. NAME. Leave empty for the default.'}>
        <TextInput value={draft.popupTitle} invalid={!!titleErr} onChange={(v) => set({ popupTitle: v })} placeholder="NAME" />
      </Row>
      <div className="hstack">
        <span className="ct-subtitle grow" style={{ margin: 0 }}>Fields shown ({draft.popupOn.length} of {draft.popupOrder.length})</span>
        <Button variant="ghost" onClick={() => set({ popupOn: [...draft.popupOrder] })}>All</Button>
        <Button variant="ghost" onClick={() => set({ popupOn: [] })}>None</Button>
        <Button variant="ghost" onClick={() => set({ popupOrder: ds?.fields.map((f) => f.name) ?? draft.popupOrder })}>Reset order</Button>
      </div>
      <div className="ct-fields tall">
        {draft.popupOrder.map((n, i) => (
          <div key={n} className="ct-fieldrow">
            <Checkbox checked={draft.popupOn.includes(n)} onChange={(v) => toggle(n, v)} label={<span>{n} <span className="muted">{types.get(n)}</span></span>} />
            <span className="grow" />
            <IconButton icon={ArrowUp} title="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
            <IconButton icon={ArrowDown} title="Move down" disabled={i === draft.popupOrder.length - 1} onClick={() => move(i, 1)} />
          </div>
        ))}
        {!draft.popupOrder.length && <div className="muted" style={{ padding: 8 }}>This layer has no fields.</div>}
      </div>
    </div>
  );
}

// ---------- map properties ----------

export function MapPropertiesDialog({ props, close }: { props: { mapId: Id }; close: () => void }) {
  const map = useMapDoc(props.mapId);
  if (!map)
    return (
      <>
        <div className="dialog-body muted">This map no longer exists.</div>
        <div className="dialog-footer"><Button onClick={close}>Close</Button></div>
      </>
    );
  return <MapEditor map={map} close={close} />;
}

const toDeg = (rad: number) => Math.round(((rad * 180) / Math.PI) * 10) / 10;

function MapEditor({ map, close }: { map: MapDoc; close: () => void }) {
  const [base, setBase] = useState(() => ({ name: map.name, basemap: map.basemap ?? '', rotation: toDeg(map.view.rotation) }));
  const [draft, setDraft] = useState(base);
  const selection = useUi((s) => s.selection);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);

  const stats = useMemo(() => {
    let features = 0, feature = 0, tile = 0, raster = 0, groups = 0, visible = 0, selected = 0;
    for (const l of map.layers) {
      if (l.kind === 'feature') {
        feature++;
        features += getDataset(l.datasetId)?.features.length ?? 0;
        selected += selection[l.id]?.length ?? 0;
      } else if (l.kind === 'tile') tile++;
      else if (l.kind === 'raster') raster++;
      else groups++;
      if (l.kind !== 'group' && isLayerVisible(map, l)) visible++;
    }
    return { features, feature, tile, raster, groups, visible, selected };
  }, [map, selection]);

  const apply = () => {
    updateMap(map.id, { name: draft.name.trim(), basemap: draft.basemap || null });
    if (draft.rotation !== base.rotation) {
      const rotation = (draft.rotation * Math.PI) / 180;
      const handle = getMapHandle(map.id);
      if (handle) handle.setViewState({ rotation }, false);
      else setView(map.id, { ...map.view, rotation });
    }
    setBase(draft);
  };

  return (
    <>
      <div className="dialog-body ct-dlg-body">
        <Row label="Name"><TextInput value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} invalid={!draft.name.trim()} autoFocus /></Row>
        <Row label="Coordinate system">
          <div className="grow ct-crs" title={map.crs}><b>{crsName(map.crs)}</b><span className="muted"> {map.crs}</span></div>
          <Button disabled={!getCommand('map.crs')} onClick={() => void runCommand('map.crs')}>Change…</Button>
        </Row>
        <Row label="Rotation">
          <NumberInput value={draft.rotation} min={-360} max={360} step={1} onChange={(v) => setDraft({ ...draft, rotation: v })} />
          <span className="muted">degrees</span>
          <Button variant="ghost" disabled={draft.rotation === 0} onClick={() => setDraft({ ...draft, rotation: 0 })}>North up</Button>
        </Row>
        <Row label="Basemap">
          <Select
            value={draft.basemap}
            onChange={(v) => setDraft({ ...draft, basemap: v })}
            options={[{ value: '', label: 'None' }, ...BASEMAPS.map((b) => ({ value: b.id, label: b.name }))]}
          />
        </Row>
        <Section title="Extent">
          <div className="ct-kv">
            <KV k="Center (lon, lat)">{map.view.center[0].toFixed(5)}, {map.view.center[1].toFixed(5)}</KV>
            <KV k="Zoom level">{map.view.zoom.toFixed(2)}</KV>
            <KV k="Bookmarks">{map.bookmarks.length}</KV>
          </div>
        </Section>
        <Section title="Layer statistics">
          <div className="ct-kv">
            <KV k="Layers">{map.layers.length - stats.groups} ({stats.visible} drawn)</KV>
            <KV k="Feature layers">{stats.feature}</KV>
            <KV k="Web / raster layers">{stats.tile} / {stats.raster}</KV>
            <KV k="Group layers">{stats.groups}</KV>
            <KV k="Total features">{stats.features.toLocaleString()}</KV>
            <KV k="Selected features">{stats.selected.toLocaleString()}</KV>
          </div>
        </Section>
      </div>
      <Footer dirty={dirty} canOk={!!draft.name.trim()} onApply={apply} onCancel={close} onOk={() => { if (dirty) apply(); close(); }} />
    </>
  );
}
