// Map coordinate system dialog.
import { useMemo, useState } from 'react';
import { Check, LocateFixed, Plus } from 'lucide-react';
import { CRS_LIST, crsName, ensureCrs, isCrsRegistered, utmCodeFor, type CrsInfo } from '../../core/crs';
import { updateMap, useMapDoc } from '../../core/store';
import { notify } from '../../core/ui';
import { registerDialog } from '../../core/registry';
import { getMapHandle } from '../../map/handle';
import { Button, Spinner, TextInput, cx } from '../../ui/kit';

const ORDER: CrsInfo['category'][] = ['Geographic', 'World', 'Continental', 'National', 'UTM', 'Polar', 'Custom'];

/** "4326", "epsg:4326" -> "EPSG:4326"; other authority codes (ESRI:54030) pass through uppercased. */
export function normaliseCode(text: string): string | null {
  const t = text.trim().toUpperCase();
  if (/^\d{3,6}$/.test(t)) return `EPSG:${t}`;
  return /^[A-Z]+:\d+$/.test(t) ? t : null;
}

function CrsDialog({ props, close }: { props: { mapId: string }; close: () => void }) {
  const doc = useMapDoc(props.mapId);
  const current = doc?.crs ?? 'EPSG:3857';
  const [selected, setSelected] = useState(current);
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, bump] = useState(0);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = CRS_LIST.filter((c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
    return ORDER.map((cat) => ({ cat, items: list.filter((c) => c.category === cat) })).filter((g) => g.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, CRS_LIST.length]);

  const resolve = async (raw: string, pick = true): Promise<boolean> => {
    const c = normaliseCode(raw);
    if (!c) {
      setError('Enter a code such as 4326 or EPSG:32633');
      return false;
    }
    setBusy(true);
    setError(null);
    const ok = await ensureCrs(c);
    setBusy(false);
    if (!ok) {
      setError(`${c} could not be found or loaded (check the code and your connection)`);
      return false;
    }
    bump((n) => n + 1);
    if (pick) setSelected(c);
    return true;
  };

  const useUtm = async () => {
    const h = getMapHandle(props.mapId);
    if (!h) return;
    const [lon, lat] = h.getViewState().center;
    await resolve(utmCodeFor(lon, lat));
  };

  const apply = async () => {
    if (!isCrsRegistered(selected) && !(await resolve(selected, false))) return;
    updateMap(props.mapId, { crs: selected });
    notify(`Map coordinate system set to ${crsName(selected)}`, 'info');
    close();
  };

  return (
    <>
      <div className="dialog-body nav-crs">
        <TextInput autoFocus placeholder="Search coordinate systems" value={query} onChange={setQuery} />
        <div className="nav-crs-list" role="listbox">
          {groups.length === 0 && <div className="muted" style={{ padding: 12 }}>No coordinate system matches "{query}".</div>}
          {groups.map((g) => (
            <div key={g.cat}>
              <div className="nav-crs-cat">{g.cat}</div>
              {g.items.map((c) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected === c.code}
                  key={c.code}
                  className={cx('nav-crs-item', selected === c.code && 'sel')}
                  onClick={() => setSelected(c.code)}
                >
                  <span className="grow">{c.name}</span>
                  <span className="code">{c.code}</span>
                  {current === c.code && <span className="nav-badge"><Check size={11} /> current</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="nav-crs-tools">
          <Button icon={LocateFixed} onClick={useUtm} disabled={busy} title="Pick the WGS 84 UTM zone containing the map centre">UTM zone for map centre</Button>
          <span className="grow" />
          <div className="hstack" style={{ width: 230 }}>
            <TextInput
              placeholder="EPSG code, e.g. 27700"
              value={code}
              invalid={!!error}
              onChange={(v) => { setCode(v); setError(null); }}
              onKeyDown={(e) => e.key === 'Enter' && code.trim() && resolve(code)}
            />
            <Button icon={Plus} onClick={() => resolve(code)} disabled={busy || !code.trim()} title="Look up and add this code">Add</Button>
          </div>
        </div>
        {(busy || error) && (
          <div className="nav-crs-status">
            {busy ? (<><Spinner /> <span className="muted">Looking up coordinate system&hellip;</span></>) : <span className="error-text">{error}</span>}
          </div>
        )}
      </div>
      <div className="dialog-footer">
        <span className="muted grow" style={{ alignSelf: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{crsName(selected)}</span>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={apply} disabled={busy || selected === current}>Apply</Button>
      </div>
    </>
  );
}

export function registerCrsDialog() {
  registerDialog({ id: 'nav-crs', title: 'Map Coordinate System', width: 560, component: CrsDialog });
}
