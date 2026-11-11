import { useEffect, useMemo, useRef, useState } from 'react';
import { Moon, Mountain, Redo2, Save, Search, Sun, Undo2, X } from 'lucide-react';
import { Ribbon } from './Ribbon';
import { ContextMenuHost, DialogHost, ToastHost } from './Overlays';
import { allCommands, getCommand, getPane, getViewDef, runCommand } from '../core/registry';
import {
  activateView, closeView, hidePane, setDockSize, setTheme, showPaneIn, useUi, type DockSide,
} from '../core/ui';
import { getMap, updateMap, useProject } from '../core/store';
import { canRedo, canUndo, redoLabel, undoLabel, useHistoryVersion } from '../core/history';
import { crsName } from '../core/crs';
import { getMapHandle } from '../map/handle';
import { Button, cx, IconButton, Spinner } from '../ui/kit';

// ---------- title bar ----------

function CommandSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return allCommands()
      .filter((c) => {
        const hay = `${c.title} ${c.keywords ?? ''} ${c.description ?? ''}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .slice(0, 14);
  }, [q]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.altKey && e.key.toLowerCase() === 'q') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p')) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const run = (id: string) => {
    setQ('');
    setOpen(false);
    inputRef.current?.blur();
    runCommand(id);
  };
  return (
    <div className="cmdsearch">
      <Search size={13} className="lead" />
      <input
        ref={inputRef}
        value={q}
        placeholder="Command Search (Alt+Q)"
        spellCheck={false}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setSel((s) => Math.min(results.length - 1, s + 1));
          else if (e.key === 'ArrowUp') setSel((s) => Math.max(0, s - 1));
          else if (e.key === 'Enter' && results[sel]) run(results[sel].id);
          else if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
      />
      {open && results.length > 0 && (
        <div className="results">
          {results.map((c, i) => (
            <div key={c.id} className={cx('result', i === sel && 'sel')} onMouseDown={() => run(c.id)} onMouseEnter={() => setSel(i)}>
              {c.icon ? <c.icon size={14} /> : <span style={{ width: 14 }} />}
              <span>{c.title}</span>
              <span className="hint">{c.shortcut ?? ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TitleBar() {
  const name = useProject((s) => s.project.name);
  const dirty = useProject((s) => s.dirty);
  const theme = useUi((s) => s.theme);
  useHistoryVersion();
  return (
    <div className="titlebar">
      <div className="logo"><Mountain size={13} /></div>
      <span className="appname">Terrane</span>
      <IconButton icon={Save} title="Save Project (Ctrl+S)" disabled={!getCommand('project.save')} onClick={() => runCommand('project.save')} />
      <IconButton icon={Undo2} title={canUndo() ? `Undo ${undoLabel()} (Ctrl+Z)` : 'Undo (Ctrl+Z)'} disabled={!canUndo()} onClick={() => runCommand('app.undo')} />
      <IconButton icon={Redo2} title={canRedo() ? `Redo ${redoLabel()} (Ctrl+Y)` : 'Redo (Ctrl+Y)'} disabled={!canRedo()} onClick={() => runCommand('app.redo')} />
      <span className="project">{name}{dirty ? ' •' : ''}</span>
      <div className="spacer" />
      <CommandSearch />
      <div className="spacer" />
      <IconButton icon={theme === 'dark' ? Sun : Moon} title="Toggle light / dark theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
    </div>
  );
}

// ---------- docks ----------

function Splitter({ side }: { side: DockSide }) {
  const [dragging, setDragging] = useState(false);
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const start = side === 'bottom' ? e.clientY : e.clientX;
    const startSize = useUi.getState().docks[side].size;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const delta = (side === 'bottom' ? ev.clientY : ev.clientX) - start;
      const size = side === 'left' ? startSize + delta : startSize - delta;
      setDockSize(side, Math.max(160, Math.min(size, side === 'bottom' ? window.innerHeight - 260 : window.innerWidth / 2)));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return <div className={cx('splitter', side === 'bottom' ? 'h' : 'v', dragging && 'dragging')} onPointerDown={onDown} />;
}

function Dock({ side }: { side: DockSide }) {
  const dock = useUi((s) => s.docks[side]);
  const paneProps = useUi((s) => s.paneProps);
  if (!dock.panes.length) return null;
  const style = side === 'bottom' ? { height: dock.size } : { width: dock.size };
  const body = (
    <div className={cx('dock', side)} style={style}>
      <div className="dock-tabs">
        {dock.panes.map((id) => {
          const def = getPane(id);
          if (!def) return null;
          return (
            <button key={id} type="button" className={cx('dock-tab', dock.active === id && 'active')} onClick={() => showPaneIn(side, id)}>
              {def.icon && <def.icon size={13} />}
              {def.title}
              <span className="x" title="Close" onClick={(e) => { e.stopPropagation(); hidePane(id); }}><X size={11} /></span>
            </button>
          );
        })}
      </div>
      <div className="dock-content">
        {dock.panes.map((id) => {
          const def = getPane(id);
          if (!def) return null;
          return (
            <div key={id} className="dock-pane" style={{ display: dock.active === id ? 'flex' : 'none' }}>
              <def.component props={paneProps[id]} />
            </div>
          );
        })}
      </div>
    </div>
  );
  return side === 'left' ? <>{body}<Splitter side={side} /></> : <><Splitter side={side} />{body}</>;
}

// ---------- views ----------

function Views() {
  const views = useUi((s) => s.views);
  const activeId = useUi((s) => s.activeViewId);
  useProject((s) => s.project); // titles
  return (
    <>
      {views.length > 0 && (
        <div className="viewtabs">
          {views.map((v) => {
            const def = getViewDef(v.type);
            return (
              <button key={v.id} type="button" className={cx('viewtab', v.id === activeId && 'active')} onClick={() => activateView(v.id)}
                onAuxClick={(e) => e.button === 1 && closeView(v.id)}>
                {def?.icon && <def.icon size={13} />}
                {def?.title(v.refId) ?? v.type}
                <span className="x" title="Close" onClick={(e) => { e.stopPropagation(); closeView(v.id); }}><X size={11} /></span>
              </button>
            );
          })}
        </div>
      )}
      <div className="views">
        {views.map((v) => {
          const def = getViewDef(v.type);
          if (!def) return null;
          return (
            <div key={v.id} className={cx('view', v.id !== activeId && 'hidden')}>
              <def.component refId={v.refId} active={v.id === activeId} />
            </div>
          );
        })}
        {views.length === 0 && (
          <div className="welcome">
            <div className="card">
              <Mountain size={44} />
              <h1>Terrane</h1>
              <div>No views are open. Create a map or open one from the Catalog pane.</div>
              <div className="hstack">
                <Button variant="primary" onClick={() => runCommand('map.new')}>New Map</Button>
                {getCommand('project.open') && <Button onClick={() => runCommand('project.open')}>Open Project…</Button>}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ---------- status bar ----------

function fmtCoord(v: number, pos: string, neg: string) {
  return `${Math.abs(v).toFixed(5)}°${v >= 0 ? pos : neg}`;
}

function ScaleBox() {
  const scale = useUi((s) => s.scale);
  const [draft, setDraft] = useState<string | null>(null);
  const text = scale ? `1:${Math.round(scale).toLocaleString()}` : '';
  const commit = (s: string) => {
    setDraft(null);
    const n = Number(s.replace(/^1\s*:/, '').replace(/[,\s]/g, ''));
    if (n > 0) getMapHandle()?.setScale(n);
  };
  return (
    <input className="scale" title="Map scale" value={draft ?? text} onChange={(e) => setDraft(e.target.value)} onFocus={(e) => e.target.select()}
      onBlur={() => setDraft(null)} onKeyDown={(e) => { if (e.key === 'Enter') { commit((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); } }} />
  );
}

function StatusBar() {
  const cursor = useUi((s) => s.cursor);
  const busy = useUi((s) => s.busy);
  const selection = useUi((s) => s.selection);
  const mapId = useUi((s) => s.activeMapId);
  const crs = useProject((s) => s.project.maps.find((m) => m.id === mapId)?.crs);
  const rotation = useProject((s) => s.project.maps.find((m) => m.id === mapId)?.view.rotation ?? 0);
  const count = Object.values(selection).reduce((n, a) => n + a.length, 0);
  return (
    <div className="statusbar">
      {mapId && <div className="cell"><ScaleBox /></div>}
      {busy && <div className="cell"><Spinner />{busy}</div>}
      <div className="spacer" />
      {mapId && Math.abs(rotation) > 1e-4 && (
        <button type="button" className="cell btn" title="Reset rotation" onClick={() => getMapHandle()?.setViewState({ rotation: 0 })}>
          {((rotation * 180) / Math.PI).toFixed(1)}°
        </button>
      )}
      {mapId && crs && (
        <button type="button" className="cell btn" title="Map coordinate system" onClick={() => (getCommand('map.crs') ? runCommand('map.crs') : undefined)}>
          {crsName(crs)}
        </button>
      )}
      <div className="cell mono" style={{ minWidth: 190, justifyContent: 'center' }}>
        {cursor ? `${fmtCoord(cursor.lon, 'E', 'W')}  ${fmtCoord(cursor.lat, 'N', 'S')}` : ''}
      </div>
      <button type="button" className="cell btn" title="Selected features — click to clear" disabled={!count}
        onClick={() => (getCommand('select.clear') ? runCommand('select.clear') : useUi.setState({ selection: {} }))}>
        Selected Features: {count.toLocaleString()}
      </button>
    </div>
  );
}

// ---------- shortcuts ----------

function keyString(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(k)) parts.push(k === ' ' ? 'Space' : k);
  return parts.join('+');
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const ks = keyString(e);
      if (typing && !/^Ctrl\+(S|O)$|^F\d+$/.test(ks)) return;
      if (useUi.getState().dialogs.length && !/^Ctrl\+S$/.test(ks)) return;
      const cmd = allCommands().find((c) => c.shortcut && c.shortcut.toLowerCase() === ks.toLowerCase());
      if (!cmd) return;
      if (cmd.enabled && !cmd.enabled()) return;
      e.preventDefault();
      runCommand(cmd.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  useShortcuts();
  const theme = useUi((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return (
    <div className="app" onContextMenu={(e) => { if (!(e.target as HTMLElement).closest('input, textarea, .selectable')) e.preventDefault(); }}>
      <TitleBar />
      <Ribbon />
      <div className="workspace">
        <Dock side="left" />
        <div className="center">
          <Views />
          <Dock side="bottom" />
        </div>
        <Dock side="right" />
      </div>
      <StatusBar />
      <DialogHost />
      <ContextMenuHost />
      <ToastHost />
    </div>
  );
}

// Re-exported for commands that rename the active map from the view tab, etc.
export { getMap, updateMap };
