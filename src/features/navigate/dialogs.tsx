// Go To XY, bookmarks and basemap dialogs.
import { useEffect, useMemo, useState } from 'react';
import { Check, Crosshair, Trash2 } from 'lucide-react';
import { BASEMAPS } from '../../core/basemaps';
import { addBookmark, removeBookmark, renameBookmark, updateMap, useMapDoc } from '../../core/store';
import { registerDialog } from '../../core/registry';
import { getMapHandle } from '../../map/handle';
import { Button, Empty, IconButton, NumberInput, Row, Select, Tabs, TextInput, cx } from '../../ui/kit';
import { formatDD, formatDMS, formatUtm, lonLatToUtm, parseCoordinate, utmToLonLat, type LatLonOrder, type ParseResult } from './coords';
import { goToLonLat } from './markers';

// ---------- Go To XY ----------

function GoToDialog({ props, close }: { props: { mapId: string; text?: string }; close: () => void }) {
  const [tab, setTab] = useState<'ll' | 'utm'>('ll');
  const [text, setText] = useState(props.text ?? '');
  const [order, setOrder] = useState<LatLonOrder>('lat-lon');
  const [zone, setZone] = useState(() => {
    const c = getMapHandle(props.mapId)?.getViewState().center;
    return c ? lonLatToUtm(c[0], c[1]).zone : 18;
  });
  const [north, setNorth] = useState(true);
  const [easting, setEasting] = useState<number | null>(null);
  const [northing, setNorthing] = useState<number | null>(null);

  const parsed: ParseResult | null = useMemo(() => {
    if (tab === 'll') return text.trim() ? parseCoordinate(text, order) : null;
    if (easting === null || northing === null) return null;
    return utmToLonLat(zone, north, easting, northing);
  }, [tab, text, order, zone, north, easting, northing]);

  const go = () => {
    if (!parsed?.ok) return;
    const h = getMapHandle(props.mapId);
    if (h) goToLonLat(h, parsed.lon, parsed.lat, formatDD(parsed.lon, parsed.lat, 5));
    close();
  };
  const fillCentre = () => {
    const c = getMapHandle(props.mapId)?.getViewState().center;
    if (!c) return;
    if (tab === 'll') setText(formatDD(c[0], c[1]));
    else {
      const u = lonLatToUtm(c[0], c[1]);
      setZone(u.zone);
      setNorth(u.north);
      setEasting(Math.round(u.easting));
      setNorthing(Math.round(u.northing));
    }
  };
  const onEnter = (e: React.KeyboardEvent) => e.key === 'Enter' && go();

  return (
    <>
      <Tabs tabs={[{ id: 'll', label: 'Latitude / Longitude' }, { id: 'utm', label: 'UTM' }]} value={tab} onChange={setTab} />
      <div className="dialog-body">
        {tab === 'll' ? (
          <>
            <Row label="Coordinates" stacked>
              <TextInput
                autoFocus
                value={text}
                onChange={setText}
                onKeyDown={onEnter}
                placeholder={`40.7128, -74.0060   or   40°42'46"N 74°0'22"W`}
                invalid={!!text.trim() && parsed?.ok === false}
              />
            </Row>
            <Row label="Order of plain numbers">
              <Select<LatLonOrder>
                value={order}
                onChange={setOrder}
                options={[{ value: 'lat-lon', label: 'Latitude, Longitude' }, { value: 'lon-lat', label: 'Longitude, Latitude (X, Y)' }]}
              />
            </Row>
          </>
        ) : (
          <>
            <Row label="Zone">
              <NumberInput value={zone} onChange={(v) => setZone(Math.round(v))} min={1} max={60} step={1} style={{ width: 70 }} />
              <Select value={north ? 'N' : 'S'} onChange={(v) => setNorth(v === 'N')} options={[{ value: 'N', label: 'North' }, { value: 'S', label: 'South' }]} />
            </Row>
            <Row label="Easting (m)"><NumberInput value={easting} onChange={setEasting} min={0} max={1000000} placeholder="e.g. 583960" /></Row>
            <Row label="Northing (m)"><NumberInput value={northing} onChange={setNorthing} min={0} max={10000000} placeholder="e.g. 4507523" /></Row>
          </>
        )}
        <div className="nav-parse" role="status">
          {parsed === null ? (
            <span className="muted">Accepts decimal degrees, degrees-minutes-seconds with N/S/E/W, or "18T 583960 4507523".</span>
          ) : parsed.ok ? (
            <>
              <div className="selectable nav-mono">{formatDMS(parsed.lon, parsed.lat)}</div>
              <div className="selectable nav-mono muted">{formatDD(parsed.lon, parsed.lat)} &middot; UTM {formatUtm(lonLatToUtm(parsed.lon, parsed.lat))}</div>
            </>
          ) : (
            <span className="error-text">{parsed.error}</span>
          )}
        </div>
      </div>
      <div className="dialog-footer">
        <Button variant="ghost" onClick={fillCentre} style={{ marginRight: 'auto' }}>Use map centre</Button>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon={Crosshair} onClick={go} disabled={!parsed?.ok}>Go</Button>
      </div>
    </>
  );
}

// ---------- bookmarks ----------

function NewBookmarkDialog({ props, close }: { props: { mapId: string }; close: () => void }) {
  const doc = useMapDoc(props.mapId);
  const [name, setName] = useState(() => `Bookmark ${(doc?.bookmarks.length ?? 0) + 1}`);
  const save = () => {
    const h = getMapHandle(props.mapId);
    const n = name.trim();
    if (!n) return;
    addBookmark(props.mapId, n, h?.getViewState());
    close();
  };
  return (
    <>
      <div className="dialog-body">
        <Row label="Name" stacked>
          <TextInput autoFocus value={name} onChange={setName} onKeyDown={(e) => e.key === 'Enter' && save()} onFocus={(e) => e.currentTarget.select()} />
        </Row>
        <div className="muted">Saves the current extent and rotation of {doc?.name ?? 'the map'}.</div>
      </div>
      <div className="dialog-footer">
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={!name.trim()}>Save</Button>
      </div>
    </>
  );
}

function RenameField({ name, onRename }: { name: string; onRename: (v: string) => void }) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const commit = (v: string) => {
    const n = v.trim();
    if (!n) setDraft(name);
    else if (n !== name) onRename(n);
  };
  return <TextInput value={draft} onChange={setDraft} onCommit={commit} />;
}

function BookmarksDialog({ props, close }: { props: { mapId: string }; close: () => void }) {
  const doc = useMapDoc(props.mapId);
  const marks = doc?.bookmarks ?? [];
  return (
    <>
      <div className="dialog-body" style={{ padding: 0, minHeight: 120 }}>
        {marks.length === 0 ? (
          <Empty title="No bookmarks">Use Bookmarks &rsaquo; New Bookmark to save the current view.</Empty>
        ) : (
          <div className="nav-bmlist">
            {marks.map((b) => (
              <div className="nav-bmrow" key={b.id}>
                <RenameField name={b.name} onRename={(v) => renameBookmark(props.mapId, b.id, v)} />
                <IconButton
                  icon={Crosshair}
                  title="Zoom to bookmark"
                  onClick={() => getMapHandle(props.mapId)?.setViewState({ center: b.center, zoom: b.zoom, rotation: b.rotation })}
                />
                <IconButton icon={Trash2} title="Delete bookmark" onClick={() => removeBookmark(props.mapId, b.id)} />
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="dialog-footer">
        <Button variant="primary" onClick={close}>Close</Button>
      </div>
    </>
  );
}

// ---------- basemap gallery ----------

function BasemapDialog({ props, close }: { props: { mapId: string }; close: () => void }) {
  const doc = useMapDoc(props.mapId);
  const pick = (id: string | null) => {
    updateMap(props.mapId, { basemap: id });
    close();
  };
  return (
    <div className="dialog-body">
      <div className="nav-bmgrid">
        {BASEMAPS.map((b) => (
          <button type="button" key={b.id} className={cx('nav-tile', doc?.basemap === b.id && 'current')} onClick={() => pick(b.id)} title={b.name}>
            <span
              className="nav-swatch"
              style={{ background: `linear-gradient(135deg, ${b.swatch[0]} 0 38%, ${b.swatch[1]} 38% 70%, ${b.swatch[2]} 70% 100%)` }}
            >
              {doc?.basemap === b.id && <Check size={16} />}
            </span>
            <span className="nav-tile-name">{b.name}</span>
          </button>
        ))}
        <button type="button" className={cx('nav-tile', doc?.basemap === null && 'current')} onClick={() => pick(null)} title="No basemap">
          <span className="nav-swatch none">{doc?.basemap === null && <Check size={16} />}</span>
          <span className="nav-tile-name">None</span>
        </button>
      </div>
    </div>
  );
}

export function registerNavDialogs() {
  registerDialog({ id: 'nav-goto', title: 'Go To XY', width: 440, component: GoToDialog });
  registerDialog({ id: 'nav-bookmark-new', title: 'New Bookmark', width: 340, component: NewBookmarkDialog });
  registerDialog({ id: 'nav-bookmarks', title: 'Bookmarks', width: 420, component: BookmarksDialog });
  registerDialog({ id: 'nav-basemap', title: 'Basemap', width: 500, component: BasemapDialog });
}
