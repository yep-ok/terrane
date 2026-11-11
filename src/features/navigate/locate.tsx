// Locate pane: place-name search using the public Nominatim service.
import { useEffect, useRef, useState } from 'react';
import { MapPin, Search } from 'lucide-react';
import { registerPane } from '../../core/registry';
import { notify } from '../../core/ui';
import { getMapHandle } from '../../map/handle';
import { Empty, Spinner, TextInput, useDebounced } from '../../ui/kit';
import { goToLonLat, placeMarker } from './markers';
import { searchPlaces, type PlaceResult } from './nominatim';

function goToPlace(p: PlaceResult) {
  const h = getMapHandle();
  if (!h) return notify('Open a map first', 'warning');
  if (p.extent) {
    placeMarker(h, p.lon, p.lat, p.name);
    h.flash([{ type: 'Point', coordinates: [p.lon, p.lat] }]);
    h.zoomToExtent(p.extent, { maxZoom: 17, padding: 60 });
  } else goToLonLat(h, p.lon, p.lat, p.name, 15);
}

function LocatePane() {
  const [text, setText] = useState('');
  const debounced = useDebounced(text.trim(), 700);
  const [forced, setForced] = useState(0);
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; results: PlaceResult[]; error?: string; query?: string }>({
    status: 'idle',
    results: [],
  });
  const lastForced = useRef(0);
  const lastQuery = useRef('');
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => () => ctl.current?.abort(), []);

  useEffect(() => {
    const isForced = forced !== lastForced.current;
    lastForced.current = forced;
    const q = isForced ? text.trim() : debounced;
    if (q.length < 3) {
      ctl.current?.abort();
      lastQuery.current = '';
      setState({ status: 'idle', results: [] });
      return;
    }
    if (q === lastQuery.current && !isForced) return;
    lastQuery.current = q;
    ctl.current?.abort();
    const mine = new AbortController();
    ctl.current = mine;
    setState((s) => ({ ...s, status: 'loading', query: q }));
    searchPlaces(q, mine.signal)
      .then((results) => setState({ status: 'done', results, query: q }))
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        const msg = String(err?.message ?? '');
        setState({
          status: 'error',
          results: [],
          error: /fetch|network/i.test(msg) ? 'Could not reach the search service. Check your connection.' : msg || 'Search failed',
          query: q,
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, forced]);

  return (
    <>
      <div className="pane-toolbar" style={{ padding: 6 }}>
        <div className="nav-search">
          <Search size={13} />
          <TextInput
            autoFocus
            placeholder="Search for a place or address"
            value={text}
            onChange={setText}
            onKeyDown={(e) => e.key === 'Enter' && setForced((n) => n + 1)}
          />
        </div>
      </div>
      <div className="pane-body">
        {state.status === 'loading' && (
          <div className="nav-search-status"><Spinner /> <span className="muted">Searching&hellip;</span></div>
        )}
        {state.status === 'error' && <div className="nav-search-status error-text">{state.error}</div>}
        {state.status === 'idle' && <Empty icon={MapPin} title="Find a place">Type at least three characters. Results zoom the map and drop a marker.</Empty>}
        {state.status === 'done' && state.results.length === 0 && <div className="nav-search-status muted">No places found for "{state.query}".</div>}
        {state.results.length > 0 && (
          <div className="nav-results" role="listbox">
            {state.results.map((r) => (
              <button type="button" key={r.id} className="nav-result" onClick={() => goToPlace(r)} title={r.detail}>
                <MapPin size={14} />
                <span className="grow">
                  <span className="nm">{r.name}</span>
                  <span className="dt">{r.type ? `${r.type} · ` : ''}{r.detail}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="pane-footer nav-attrib">
        <span>
          Search by <a href="https://nominatim.org" target="_blank" rel="noopener noreferrer">Nominatim</a>, data &copy;{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors
        </span>
      </div>
    </>
  );
}

export function registerLocate() {
  registerPane({ id: 'locate', title: 'Locate', icon: Search, dock: 'right', component: LocatePane });
}
