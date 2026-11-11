// Geoprocessing pane: toolbox, tool form with run/progress/messages, and history.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Ban, ChevronDown, ChevronRight, CircleCheck, CircleX, History as HistoryIcon, Play, RotateCcw, Search, Square, Star, Trash2, Wrench, X } from 'lucide-react';
import { findFeatureLayer, findLayer, useProject } from '../../core/store';
import { useUi } from '../../core/ui';
import { Button, Empty, IconButton, Tabs, TextInput, cx } from '../../ui/kit';
import { ToolForm } from './ToolForm';
import { applyDefaults } from './exec';
import { clearHistory, recentToolIds, removeHistory, toggleFavorite, useGpPrefs, type HistoryEntry, type LogLine } from './history';
import { categoryIcon, toolIcon } from './icons';
import { cancelRun, executeRun, fmtElapsed, geomMatches, useRunState } from './runner';
import { ALL_TOOLS, getTool } from './tools';
import { CATEGORIES, type ToolDef } from './types';
import { validateParams } from './validate';
import './gp.css';

/** Form values survive switching between tools within a session. */
const formState = new Map<string, Record<string, any>>();

function initialParams(tool: ToolDef): Record<string, any> {
  const params = applyDefaults(tool, {});
  const active = useUi.getState().activeLayerId;
  const first = tool.params.find((p) => p.kind === 'layer' && !p.multiple);
  if (active && first && first.kind === 'layer') {
    const hit = findFeatureLayer(active);
    if (hit && geomMatches(first.geom, hit.dataset.geomType)) params[first.name] = active;
  }
  return params;
}

export function GpPane({ props }: { props?: { toolId?: string; params?: Record<string, any>; history?: boolean; nonce?: number } }) {
  const [tab, setTab] = useState<'tools' | 'history'>('tools');
  const [toolId, setToolId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!props) return;
    if (props.toolId && getTool(props.toolId)) {
      if (props.params) formState.set(props.toolId, props.params);
      else if (props.nonce) formState.delete(props.toolId);
      setToolId(props.toolId);
      setTab('tools');
      setVersion((v) => v + 1);
    } else if (props.history) {
      setToolId(null);
      setTab('history');
    } else {
      setToolId(null);
      setTab('tools');
    }
  }, [props?.nonce, props?.toolId, props?.history]); // eslint-disable-line react-hooks/exhaustive-deps

  const tool = toolId ? getTool(toolId) : undefined;
  return (
    <div className="gp-root">
      {tool ? (
        <ToolView key={`${tool.id}:${version}`} tool={tool} onBack={() => setToolId(null)} />
      ) : (
        <>
          <Tabs
            tabs={[{ id: 'tools', label: 'Toolbox' }, { id: 'history', label: 'History' }]}
            value={tab}
            onChange={setTab}
          />
          {tab === 'tools' ? (
            <Toolbox onOpen={setToolId} />
          ) : (
            <HistoryView
              onOpen={(e) => {
                formState.set(e.toolId, e.params);
                setVersion((v) => v + 1);
                setToolId(e.toolId);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------- toolbox ----------

function matchTools(query: string): ToolDef[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return ALL_TOOLS;
  const scored: Array<[number, ToolDef]> = [];
  for (const t of ALL_TOOLS) {
    const name = t.name.toLowerCase();
    const hay = `${name} ${t.category.toLowerCase()} ${t.keywords.join(' ').toLowerCase()} ${t.description.toLowerCase()}`;
    if (!terms.every((x) => hay.includes(x))) continue;
    scored.push([terms.reduce((s, x) => s + (name.startsWith(x) ? 3 : name.includes(x) ? 2 : t.keywords.some((k) => k.includes(x)) ? 1 : 0), 0), t]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}

function ToolRow({ tool, showDesc, onOpen }: { tool: ToolDef; showDesc: boolean; onOpen(id: string): void }) {
  const fav = useGpPrefs((s) => s.favorites.includes(tool.id));
  const Icon = toolIcon(tool.id);
  return (
    <div
      className={cx('gp-tool', showDesc && 'flat')}
      role="button"
      tabIndex={0}
      title={tool.description}
      onClick={() => onOpen(tool.id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(tool.id))}
    >
      <Icon className="gp-tool-icon" size={15} />
      <div className="gp-tool-main">
        <div className="gp-tool-name">{tool.name}{showDesc && <span className="gp-tool-cat">{tool.category}</span>}</div>
        {showDesc && <div className="gp-tool-desc">{tool.description}</div>}
      </div>
      <button
        type="button"
        className={cx('gp-star', fav && 'on')}
        title={fav ? 'Remove from favorites' : 'Add to favorites'}
        aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
        onClick={(e) => {
          e.stopPropagation();
          toggleFavorite(tool.id);
        }}
      >
        <Star size={13} />
      </button>
    </div>
  );
}

function Group({ title, icon: Icon, count, open, onToggle, children }: { title: string; icon: any; count: number; open: boolean; onToggle(): void; children: React.ReactNode }) {
  return (
    <div className="gp-group">
      <button type="button" className="gp-group-head" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Icon size={14} />
        <span className="grow">{title}</span>
        <span className="gp-count">{count}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

function Toolbox({ onOpen }: { onOpen(id: string): void }) {
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const favorites = useGpPrefs((s) => s.favorites);
  const history = useGpPrefs((s) => s.history);
  const searching = query.trim().length > 0;
  const found = useMemo(() => matchTools(query), [query]);
  const toggle = (k: string) => setClosed((c) => { const n = new Set(c); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const favTools = favorites.map(getTool).filter(Boolean) as ToolDef[];
  const recent = recentToolIds(history).map(getTool).filter(Boolean) as ToolDef[];
  return (
    <>
      <div className="gp-search">
        <Search size={13} className="lead" />
        <TextInput value={query} onChange={setQuery} placeholder={`Search ${ALL_TOOLS.length} tools`} aria-label="Search tools" />
        {searching && <IconButton icon={X} title="Clear search" onClick={() => setQuery('')} />}
      </div>
      <div className="pane-body">
        {searching ? (
          found.length ? (
            found.map((t) => <ToolRow key={t.id} tool={t} showDesc onOpen={onOpen} />)
          ) : (
            <Empty icon={Search} title="No matching tools">Try a different word, such as "buffer", "count" or "grid".</Empty>
          )
        ) : (
          <>
            {favTools.length > 0 && (
              <Group title="Favorites" icon={Star} count={favTools.length} open={!closed.has('fav')} onToggle={() => toggle('fav')}>
                {favTools.map((t) => <ToolRow key={t.id} tool={t} showDesc={false} onOpen={onOpen} />)}
              </Group>
            )}
            {recent.length > 0 && (
              <Group title="Recent" icon={HistoryIcon} count={recent.length} open={!closed.has('recent')} onToggle={() => toggle('recent')}>
                {recent.map((t) => <ToolRow key={t.id} tool={t} showDesc={false} onOpen={onOpen} />)}
              </Group>
            )}
            {CATEGORIES.map((cat) => {
              const list = ALL_TOOLS.filter((t) => t.category === cat);
              if (!list.length) return null;
              return (
                <Group key={cat} title={cat} icon={categoryIcon(cat)} count={list.length} open={!closed.has(cat)} onToggle={() => toggle(cat)}>
                  {list.map((t) => <ToolRow key={t.id} tool={t} showDesc={false} onOpen={onOpen} />)}
                </Group>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}

// ---------- tool view ----------

function LogView({ lines, running }: { lines: LogLine[]; running?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (running && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length, running]);
  return (
    <div className="gp-log selectable" ref={ref}>
      {lines.map((l, i) => (
        <div key={i} className={cx('gp-line', l.level)}>
          <span className="gp-time">{(l.at / 1000).toFixed(2)}s</span>
          <span className="gp-text">{l.text}</span>
        </div>
      ))}
    </div>
  );
}

function RunBar({ toolId }: { toolId: string }) {
  const active = useRunState((s) => s.active);
  const [now, setNow] = useState(() => Date.now());
  const startedAt = useRunState((s) => s.runs[toolId]?.startedAt);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (!active) return null;
  const pct = Math.round(active.fraction * 100);
  return (
    <div className="gp-runbar">
      <div className="gp-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${Math.max(4, pct)}%` }} className={cx(active.fraction === 0 && 'indeterminate')} />
      </div>
      <div className="gp-runmsg">
        <span className="grow">{active.message}</span>
        <span className="muted">{startedAt ? fmtElapsed(now - startedAt) : ''}</span>
      </div>
    </div>
  );
}

function ToolView({ tool, onBack }: { tool: ToolDef; onBack(): void }) {
  const [params, setState] = useState<Record<string, any>>(() => formState.get(tool.id) ?? initialParams(tool));
  const setParams = (p: Record<string, any>) => {
    formState.set(tool.id, p);
    setState(p);
  };
  useProject((s) => s.project.maps); // re-validate when layers change
  const active = useRunState((s) => s.active);
  const summary = useRunState((s) => s.runs[tool.id]);
  const fav = useGpPrefs((s) => s.favorites.includes(tool.id));
  const errors = validateParams(tool, params);
  const invalid = Object.keys(errors).length > 0;
  const busy = !!active;
  const mine = active?.toolId === tool.id;
  const Icon = toolIcon(tool.id);
  const firstError = tool.params.find((p) => errors[p.name]);

  return (
    <>
      <div className="pane-toolbar gp-head">
        <IconButton icon={ArrowLeft} title="Back to toolbox" onClick={onBack} />
        <Icon size={15} className="gp-tool-icon" />
        <div className="gp-title grow">{tool.name}</div>
        <IconButton icon={Star} title={fav ? 'Remove from favorites' : 'Add to favorites'} active={fav} onClick={() => toggleFavorite(tool.id)} />
        <IconButton
          icon={RotateCcw}
          title="Reset parameters"
          disabled={busy}
          onClick={() => {
            formState.delete(tool.id);
            setState(initialParams(tool));
          }}
        />
      </div>
      <div className="pane-body padded">
        <div className="gp-desc selectable">
          <span className="gp-cat">{tool.category}</span> {tool.description}
        </div>
        <ToolForm tool={tool} params={params} errors={errors} onChange={setParams} disabled={busy} />
        {summary && (
          <div className="gp-messages">
            <div className="gp-messages-head">
              <span className="grow">Messages</span>
              <StatusBadge status={summary.status} elapsed={summary.elapsedMs} />
            </div>
            <LogView lines={summary.lines} running={summary.status === 'running'} />
          </div>
        )}
      </div>
      <div className="pane-footer gp-footer">
        {mine ? (
          <>
            <RunBar toolId={tool.id} />
            <Button icon={Square} variant="danger" onClick={cancelRun}>Cancel</Button>
          </>
        ) : (
          <>
            <span className="grow gp-validity" title={firstError ? errors[firstError.name] : undefined}>
              {busy ? 'Another tool is running.' : firstError ? `${firstError.label}: ${errors[firstError.name]}` : ''}
            </span>
            <Button icon={Play} variant="primary" disabled={invalid || busy} onClick={() => void executeRun(tool, params)}>
              Run
            </Button>
          </>
        )}
      </div>
    </>
  );
}

function StatusBadge({ status, elapsed }: { status: HistoryEntry['status'] | 'running'; elapsed: number | null }) {
  const label = status === 'running' ? 'Running' : status === 'success' ? 'Succeeded' : status === 'cancelled' ? 'Cancelled' : 'Failed';
  return (
    <span className={cx('gp-badge', status)}>
      {label}
      {elapsed !== null && ` · ${fmtElapsed(elapsed)}`}
    </span>
  );
}

// ---------- history ----------

function HistoryView({ onOpen }: { onOpen(e: HistoryEntry): void }) {
  const history = useGpPrefs((s) => s.history);
  const [open, setOpen] = useState<string | null>(null);
  if (!history.length)
    return (
      <div className="pane-body">
        <Empty icon={HistoryIcon} title="No runs yet">Tools you run appear here with their parameters, so you can open and repeat them.</Empty>
      </div>
    );
  return (
    <>
      <div className="pane-toolbar">
        <span className="muted grow">{history.length} run{history.length === 1 ? '' : 's'}</span>
        <Button variant="ghost" icon={Trash2} onClick={clearHistory}>Clear</Button>
      </div>
      <div className="pane-body">
        {history.map((h) => {
          const Icon = h.status === 'success' ? CircleCheck : h.status === 'cancelled' ? Ban : CircleX;
          const expanded = open === h.id;
          const tool = getTool(h.toolId);
          const missing = Object.values(h.params).some((v) => typeof v === 'string' && /^lyr_/.test(v) && !findLayer(v));
          return (
            <div key={h.id} className={cx('gp-hist', expanded && 'open')}>
              <div className="gp-hist-row" role="button" tabIndex={0} onClick={() => setOpen(expanded ? null : h.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(expanded ? null : h.id)}>
                <Icon size={15} className={cx('gp-hist-icon', h.status)} />
                <div className="gp-hist-main">
                  <div className="gp-tool-name">{h.toolName}</div>
                  <div className="gp-tool-desc">
                    {new Date(h.startedAt).toLocaleString()} · {fmtElapsed(h.elapsedMs)}
                    {h.output ? ` · ${h.output} (${(h.count ?? 0).toLocaleString()})` : ''}
                  </div>
                </div>
                <IconButton icon={Wrench} title={tool ? 'Open with these parameters' : 'Tool no longer available'} disabled={!tool} onClick={(e) => { e.stopPropagation(); onOpen(h); }} />
                <IconButton icon={X} title="Remove from history" onClick={(e) => { e.stopPropagation(); removeHistory(h.id); }} />
              </div>
              {expanded && (
                <div className="gp-hist-detail">
                  {missing && <div className="gp-note">Some layers used by this run are no longer in the project; choose them again after opening.</div>}
                  <LogView lines={h.lines} />
                  <div className="hstack" style={{ marginTop: 6 }}>
                    <Button variant="primary" disabled={!tool} onClick={() => onOpen(h)}>Open in tool</Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
