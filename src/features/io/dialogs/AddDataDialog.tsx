// Add Data dialog: Files, From URL, Web Services, Sample Data.
import { useRef, useState } from 'react';
import { Cloud, FileUp, Globe, Layers, Link2, Map as MapIcon, Server, Sparkles } from 'lucide-react';
import { Button, Checkbox, Empty, NumberInput, Row, Select, Spinner, Tabs, TextInput } from '../../../ui/kit';
import { notify, setBusy } from '../../../core/ui';
import { ACCEPT, SUPPORTED_FORMATS } from '../parse';
import { addTileLayerToMap, commitImport, ensureActiveMap, fmtCount, importFiles, importUrl } from '../importer';
import {
  ARCGIS_LAYER_RE, ARCGIS_SERVICE_RE, fetchArcgisFeatures, fetchArcgisServiceLayers, fetchWfsFeatureTypes, fetchWfsFeatures, fetchWmsCapabilities,
  stripOgcParams, type ServiceLayer, type WmsCapabilities,
} from '../services';
import { SAMPLES, addSamples, createSampleMap, type SampleId } from '../samples';

type TabId = 'files' | 'url' | 'services' | 'samples';
type ServiceKind = 'xyz' | 'wms' | 'arcgis' | 'wfs';

export function AddDataDialog({ props, close }: { props: { tab?: TabId }; close: () => void }) {
  const [tab, setTab] = useState<TabId>(props.tab ?? 'files');
  return (
    <>
      <Tabs<TabId>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'files', label: 'Files' },
          { id: 'url', label: 'From URL' },
          { id: 'services', label: 'Web Services' },
          { id: 'samples', label: 'Sample Data' },
        ]}
      />
      <div className="dialog-body io-add">
        {tab === 'files' && <FilesTab close={close} />}
        {tab === 'url' && <UrlTab close={close} />}
        {tab === 'services' && <ServicesTab close={close} />}
        {tab === 'samples' && <SamplesTab close={close} />}
      </div>
      <div className="dialog-footer">
        <Button onClick={close}>Close</Button>
      </div>
    </>
  );
}

// ---------- files ----------

function FilesTab({ close }: { close: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const go = (files: File[]) => {
    if (!files.length) return;
    close();
    void importFiles(files);
  };
  return (
    <div className="vstack" style={{ gap: 12 }}>
      <div
        className={`io-drop${over ? ' over' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          go(Array.from(e.dataTransfer.files));
        }}
      >
        <FileUp />
        <div className="title">Drop files here or click to browse</div>
        <div className="muted">Select several files at once to add a shapefile's .shp, .dbf and .prj together.</div>
      </div>
      <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => go(Array.from(e.target.files ?? []))} />
      <table className="io-formats">
        <tbody>
          {SUPPORTED_FORMATS.map((f) => (
            <tr key={f.label}>
              <td className="name">{f.label}</td>
              <td className="ext">{f.extensions.map((x) => `.${x}`).join(' ')}</td>
              <td className="muted">{f.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- url ----------

function UrlTab({ close }: { close: () => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusyLocal] = useState(false);
  const go = async () => {
    setError('');
    setBusyLocal(true);
    try {
      await importUrl(url);
      close();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyLocal(false);
    }
  };
  return (
    <div className="vstack" style={{ gap: 10 }}>
      <Row label="URL" stacked hint="GeoJSON, TopoJSON, CSV, KML/KMZ, GPX, zipped shapefile, FlatGeobuf or GeoTIFF. The server must allow cross-origin (CORS) requests.">
        <TextInput value={url} onChange={setUrl} placeholder="https://example.com/data.geojson" autoFocus onKeyDown={(e) => e.key === 'Enter' && url.trim() && void go()} />
      </Row>
      {error && <div className="error-text selectable">{error}</div>}
      <div className="hstack">
        <Button variant="primary" icon={Link2} disabled={!url.trim() || busy} onClick={() => void go()}>
          Add to map
        </Button>
        {busy && <Spinner />}
      </div>
    </div>
  );
}

// ---------- web services ----------

function ServicesTab({ close }: { close: () => void }) {
  const [kind, setKind] = useState<ServiceKind>('xyz');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [attribution, setAttribution] = useState('');
  const [maxZoom, setMaxZoom] = useState(19);
  const [tiles, setTiles] = useState(false);
  const [limit, setLimit] = useState(10000);
  const [error, setError] = useState('');
  const [busy, setBusyLocal] = useState(false);
  const [items, setItems] = useState<ServiceLayer[] | null>(null);
  const [wms, setWms] = useState<WmsCapabilities | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');

  const reset = () => {
    setItems(null);
    setWms(null);
    setPicked(new Set());
    setError('');
  };
  const run = async (fn: () => Promise<void>) => {
    setError('');
    setBusyLocal(true);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyLocal(false);
      setBusy(null);
    }
  };
  const cleanUrl = () => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) throw new Error('Enter a full http(s) URL');
    return u;
  };

  // --- XYZ
  const addXyz = () =>
    run(async () => {
      const u = cleanUrl();
      if (!/\{x\}/.test(u) || !/\{-?y\}/.test(u)) throw new Error('A tile template needs {z}/{x}/{y} placeholders, e.g. https://tile.example.com/{z}/{x}/{y}.png');
      const nm = name.trim() || new URL(u.replace(/\{[^}]*\}/g, '0')).host;
      addTileLayerToMap(nm, { type: 'xyz', url: u, attribution: attribution.trim() || undefined, maxZoom });
      notify(`Added tile layer "${nm}"`, 'success');
      close();
    });

  // --- listing (WMS / WFS / ArcGIS service root)
  const connect = () =>
    run(async () => {
      const u = cleanUrl();
      reset();
      if (kind === 'wms') {
        const caps = await fetchWmsCapabilities(u);
        setWms(caps);
        setItems(caps.layers);
      } else if (kind === 'wfs') {
        setItems(await fetchWfsFeatureTypes(u));
      } else if (ARCGIS_LAYER_RE.test(u)) {
        await addArcgisLayers([u.split('?')[0]]);
      } else if (ARCGIS_SERVICE_RE.test(u)) {
        if (tiles) {
          const nm = name.trim() || 'ArcGIS map service';
          addTileLayerToMap(nm, { type: 'arcgis-tile', url: u.split('?')[0].replace(/\/+$/, '') });
          notify(`Added "${nm}" as map tiles`, 'success');
          close();
        } else setItems(await fetchArcgisServiceLayers(u));
      } else throw new Error('Enter an ArcGIS REST URL ending in FeatureServer, MapServer, or a layer such as .../FeatureServer/0');
    });

  const addArcgisLayers = async (layerUrls: string[]) => {
    const layers = [];
    for (const lu of layerUrls) {
      setBusy('Downloading features…');
      const res = await fetchArcgisFeatures(lu, (n) => setBusy(`Downloading features… ${fmtCount(n)}`));
      layers.push({ layer: { name: res.name, features: res.features, warnings: res.truncated ? [`Stopped after ${fmtCount(res.features.length)} features`] : [] }, source: lu });
    }
    setBusy(null);
    close();
    await commitImport(layers);
  };

  const addSelected = () =>
    run(async () => {
      const u = cleanUrl();
      const chosen = (items ?? []).filter((l) => picked.has(l.name));
      if (!chosen.length) throw new Error('Select at least one layer');
      if (kind === 'wms') {
        const caps = wms!;
        const fmt = caps.formats.find((f) => f === 'image/png') ?? caps.formats.find((f) => /png|jpeg/.test(f)) ?? 'image/png';
        const base = stripOgcParams(u);
        const mapId = ensureActiveMap();
        for (const l of chosen) addTileLayerToMap(l.title, { type: 'wms', url: base, layers: l.name, params: { VERSION: caps.version, FORMAT: fmt, TRANSPARENT: 'TRUE' } }, mapId);
        notify(`Added ${chosen.length} WMS layer${chosen.length === 1 ? '' : 's'}`, 'success');
        close();
      } else if (kind === 'wfs') {
        const out = [];
        for (const l of chosen) {
          setBusy(`Downloading ${l.title}…`);
          out.push({ layer: { name: l.title.replace(/^.*:/, ''), features: await fetchWfsFeatures(u, l.name, limit) }, source: u });
        }
        setBusy(null);
        close();
        await commitImport(out);
      } else {
        const base = u.split('?')[0].replace(/\/+$/, '');
        await addArcgisLayers(chosen.map((l) => `${base}/${l.name}`));
      }
    });

  const shown = (items ?? []).filter((l) => !filter || `${l.title} ${l.name}`.toLowerCase().includes(filter.toLowerCase()));
  const toggle = (n: string) =>
    setPicked((p) => {
      const next = new Set(p);
      next.has(n) ? next.delete(n) : next.add(n);
      return next;
    });

  return (
    <div className="vstack" style={{ gap: 10 }}>
      <Row label="Service type">
        <Select<ServiceKind>
          value={kind}
          onChange={(k) => {
            setKind(k);
            reset();
          }}
          options={[
            { value: 'xyz', label: 'XYZ tiles (slippy map template)' },
            { value: 'wms', label: 'WMS (map image service)' },
            { value: 'arcgis', label: 'ArcGIS REST (FeatureServer / MapServer)' },
            { value: 'wfs', label: 'WFS (GeoJSON features)' },
          ]}
        />
      </Row>
      <Row label={kind === 'xyz' ? 'URL template' : 'Service URL'}>
        <TextInput
          value={url}
          onChange={(v) => {
            setUrl(v);
            if (items) reset();
          }}
          autoFocus
          placeholder={
            kind === 'xyz' ? 'https://tile.example.com/{z}/{x}/{y}.png'
            : kind === 'wms' ? 'https://example.com/geoserver/wms'
            : kind === 'wfs' ? 'https://example.com/geoserver/wfs'
            : 'https://services.example.com/arcgis/rest/services/Name/FeatureServer/0'
          }
        />
      </Row>

      {kind === 'xyz' && (
        <>
          <Row label="Name">
            <TextInput value={name} onChange={setName} placeholder="Optional" />
          </Row>
          <Row label="Attribution">
            <TextInput value={attribution} onChange={setAttribution} placeholder="Optional, shown on the map" />
          </Row>
          <Row label="Max zoom">
            <NumberInput value={maxZoom} onChange={setMaxZoom} min={1} max={24} style={{ width: 70 }} />
          </Row>
        </>
      )}
      {kind === 'arcgis' && (
        <Checkbox checked={tiles} onChange={setTiles} label="Add a MapServer URL as map tiles instead of listing its layers" />
      )}
      {kind === 'wfs' && (
        <Row label="Max features">
          <NumberInput value={limit} onChange={setLimit} min={1} max={500000} style={{ width: 90 }} />
        </Row>
      )}

      {items && (
        <div className="io-choices">
          <div className="hstack" style={{ padding: '4px 6px' }}>
            <TextInput value={filter} onChange={setFilter} placeholder="Filter layers" />
            <span className="muted" style={{ whiteSpace: 'nowrap' }}>{picked.size} selected</span>
          </div>
          <div className="io-list">
            {shown.length === 0 && <Empty title="No layers match" />}
            {shown.map((l, i) => (
              <label key={`${l.name}-${i}`} className={`io-choice${l.selectable ? '' : ' group'}`} style={{ paddingLeft: 8 + l.depth * 14 }}>
                {l.selectable ? <input type="checkbox" checked={picked.has(l.name)} onChange={() => toggle(l.name)} /> : <Layers size={13} />}
                <span className="grow" title={l.name}>{l.title}</span>
                {l.selectable && l.title !== l.name && <span className="muted io-choice-id">{l.name}</span>}
              </label>
            ))}
          </div>
        </div>
      )}
      {error && <div className="error-text selectable">{error}</div>}
      <div className="hstack">
        {kind === 'xyz' ? (
          <Button variant="primary" icon={Globe} disabled={!url.trim() || busy} onClick={() => void addXyz()}>
            Add tile layer
          </Button>
        ) : (
          <>
            <Button icon={Server} disabled={!url.trim() || busy} onClick={() => void connect()}>
              {kind === 'arcgis' && ARCGIS_LAYER_RE.test(url) ? 'Download layer' : 'Get layers'}
            </Button>
            {items && (
              <Button variant="primary" icon={Cloud} disabled={!picked.size || busy} onClick={() => void addSelected()}>
                Add selected
              </Button>
            )}
          </>
        )}
        {busy && <Spinner />}
      </div>
      <div className="muted io-note">
        Services are fetched directly from your browser, so the server has to allow cross-origin requests.
      </div>
    </div>
  );
}

// ---------- samples ----------

function SamplesTab({ close }: { close: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const add = async (id: SampleId | 'map') => {
    setBusyId(id);
    try {
      if (id === 'map') await createSampleMap();
      else await addSamples([id]);
      close();
    } catch (e: any) {
      notify(e?.message ?? String(e), 'error');
    } finally {
      setBusyId(null);
    }
  };
  return (
    <div className="vstack" style={{ gap: 8 }}>
      {SAMPLES.map((s) => (
        <div key={s.id} className="io-sample">
          <Globe />
          <div className="grow">
            <div className="title">{s.title}</div>
            <div className="muted">{s.description}</div>
          </div>
          <Button disabled={!!busyId} onClick={() => void add(s.id)}>
            {busyId === s.id ? <Spinner /> : 'Add to map'}
          </Button>
        </div>
      ))}
      <div className="io-sample featured">
        <Sparkles />
        <div className="grow">
          <div className="title">World map</div>
          <div className="muted">A new map with countries coloured by continent and the major cities.</div>
        </div>
        <Button variant="primary" icon={MapIcon} disabled={!!busyId} onClick={() => void add('map')}>
          Create map
        </Button>
      </div>
      <div className="muted io-note">Everything on this tab is bundled with Terrane and works offline (basemaps still need a network).</div>
    </div>
  );
}
