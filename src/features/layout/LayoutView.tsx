// Layout view: page on a pasteboard with zoom/pan, rulers, grid, selection, move/resize with
// snapping, inline text editing and map-frame activation.
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Maximize, Scan, ZoomIn, ZoomOut, FileText } from 'lucide-react';
import type { Id, LayoutDoc, LayoutElement } from '../../core/types';
import { getLayout, updateLayout, useLayoutDoc, useProject } from '../../core/store';
import { showContextMenu, useUi, type MenuItem } from '../../core/ui';
import { openPane } from '../../core/registry';
import { Empty, IconButton } from '../../ui/kit';
import {
  clamp, HANDLES, NOMINAL_PX_PER_MM, parseScale, formatScale, rectFromPoints, rectsIntersect, resizeRect, snapMove, snapTargets,
  snapToGrid, snapValue, type Handle, type Rect,
} from './geometry';
import {
  editLayout, getViewState, recordUndo, setSelectionIds, setViewState, useLayoutSession, useViewState,
} from './session';
import {
  copySelection, cutSelection, deleteSelection, duplicateSelection, hasClipboard, marginOf, nudge, paste, reorder, selectAll,
  setLocked, zoomAt, zoomStep, zoomToPage, zoomActual,
} from './actions';
import { drawElement, textFont } from './draw';
import { MapFrame } from './MapFrame';
import { frameScale, zoomForScale, frameCrs } from './scale';
import { getMap } from '../../core/store';
import type { MapFrameProps, TextProps } from './types';

const RULER = 18;

// ---------- element canvas ----------

const ElementCanvas = memo(function ElementCanvas({ el, layout, zoom }: { el: LayoutElement; layout: LayoutDoc; zoom: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const maps = useProject((s) => s.project.maps);
  const projectName = useProject((s) => s.project.name);
  const [assetTick, setAssetTick] = useState(0);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    let dpr = window.devicePixelRatio || 1;
    const maxSide = Math.max(el.w, el.h) * zoom * dpr;
    if (maxSide > 8192) dpr *= 8192 / maxSide;
    const k = zoom * dpr;
    const W = Math.max(1, Math.round(el.w * k));
    const H = Math.max(1, Math.round(el.h * k));
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawElement(ctx, el, { layout, k: W / el.w, onAsset: () => setAssetTick((t) => t + 1) });
  }, [el, layout, zoom, maps, projectName, assetTick]);
  return <canvas ref={ref} className="layout-el-canvas" />;
});

// ---------- rulers ----------

function Ruler({ orient, length, offset, zoom, theme, cursorRef }: {
  orient: 'h' | 'v'; length: number; offset: number; zoom: number; theme: string; cursorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const L = Math.max(1, length);
    const W = orient === 'h' ? L : RULER;
    const H = orient === 'h' ? RULER : L;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    c.style.width = W + 'px';
    c.style.height = H + 'px';
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(c);
    const bg = css.getPropertyValue('--bg-2').trim() || '#26282c';
    const fg = css.getPropertyValue('--text-dim').trim() || '#9da2ab';
    const line = css.getPropertyValue('--border-strong').trim() || '#55595f';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = line;
    ctx.fillStyle = fg;
    ctx.lineWidth = 1;
    ctx.font = '9px ' + (css.getPropertyValue('--font') || 'sans-serif');
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    const minor = steps.find((s) => s * zoom >= 5) ?? 500;
    const major = steps.find((s) => s >= minor * 5 && s * zoom >= 40) ?? minor * 10;
    const start = Math.floor(-offset / zoom / minor) * minor;
    const end = (L - offset) / zoom;
    ctx.beginPath();
    for (let mm = start; mm <= end; mm += minor) {
      const p = Math.round(offset + mm * zoom) + 0.5;
      const isMajor = Math.abs(mm % major) < 1e-6;
      const half = Math.abs(mm % (major / 2)) < 1e-6;
      const t = isMajor ? RULER : half ? RULER * 0.45 : RULER * 0.25;
      if (orient === 'h') {
        ctx.moveTo(p, RULER);
        ctx.lineTo(p, RULER - t);
      } else {
        ctx.moveTo(RULER, p);
        ctx.lineTo(RULER - t, p);
      }
      if (isMajor) {
        const label = String(Math.round(mm));
        if (orient === 'h') ctx.fillText(label, p + 2, 9);
        else {
          ctx.save();
          ctx.translate(9, p + 2);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = 'right';
          ctx.fillText(label, 0, 0);
          ctx.restore();
        }
      }
    }
    ctx.stroke();
    ctx.beginPath();
    if (orient === 'h') {
      ctx.moveTo(0, RULER - 0.5);
      ctx.lineTo(W, RULER - 0.5);
    } else {
      ctx.moveTo(RULER - 0.5, 0);
      ctx.lineTo(RULER - 0.5, H);
    }
    ctx.stroke();
  }, [orient, length, offset, zoom, theme]);
  return (
    <div className={`layout-ruler ${orient}`}>
      <canvas ref={ref} />
      <div ref={cursorRef} className="layout-ruler-cursor" />
    </div>
  );
}

// ---------- inline text editor ----------

function TextEditor({ layoutId, el, zoom }: { layoutId: Id; el: LayoutElement; zoom: number }) {
  const p = el.props as TextProps;
  const [value, setValue] = useState(p.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit && value !== p.text) {
      editLayout(layoutId, 'Edit Text', (l) => {
        const e = l.elements.find((x) => x.id === el.id);
        if (e) e.props = { ...e.props, text: value };
      });
    }
    setViewState(layoutId, { editingText: null });
  };
  const f = textFont(p);
  return (
    <textarea
      ref={ref}
      className="layout-text-editor"
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') finish(false);
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish(true);
      }}
      style={{
        fontFamily: f.family, fontSize: f.size * zoom, fontWeight: f.bold ? 700 : 400, fontStyle: f.italic ? 'italic' : 'normal',
        lineHeight: p.lineHeight || 1.2, color: p.color, textAlign: p.align, padding: (p.padding ?? 0) * zoom,
        background: p.background || 'rgba(255,255,255,0.92)',
      }}
    />
  );
}

// ---------- active frame toolbar ----------

function FrameBar({ layoutId, el }: { layoutId: Id; el: LayoutElement }) {
  const p = el.props as MapFrameProps;
  const scale = frameScale(el);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    setDraft(null);
    const s = parseScale(text);
    if (!s) return;
    const zoom = zoomForScale(p.view, frameCrs(getMap(p.mapId)), s);
    if (zoom == null) return;
    editLayout(layoutId, 'Set Map Frame Scale', (l) => {
      const e = l.elements.find((x) => x.id === el.id);
      if (e) e.props = { ...e.props, view: { ...p.view, zoom } };
    });
  };
  return (
    <div className="layout-framebar" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <span className="muted">Scale</span>
      <input
        className="input mono"
        value={draft ?? formatScale(scale)}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'Escape') setDraft(null);
        }}
      />
      <button type="button" className="btn primary" onClick={() => setViewState(layoutId, { activeFrame: null })}>
        <Check />
        Done
      </button>
    </div>
  );
}

// ---------- the view ----------

type Drag =
  | { kind: 'pan'; sx: number; sy: number; px: number; py: number }
  | { kind: 'move'; sx: number; sy: number; started: boolean; before: LayoutDoc; orig: Map<Id, Rect>; bounds: Rect }
  | { kind: 'resize'; sx: number; sy: number; before: LayoutDoc; id: Id; start: Rect; handle: Handle }
  | { kind: 'marquee'; x0: number; y0: number; additive: boolean; base: Id[] };

export function LayoutView({ refId, active }: { refId: string; active: boolean }) {
  const layout = useLayoutDoc(refId);
  const zoom = useViewState(refId, (v) => v.zoom);
  const panX = useViewState(refId, (v) => v.panX);
  const panY = useViewState(refId, (v) => v.panY);
  const selection = useViewState(refId, (v) => v.selection);
  const activeFrame = useViewState(refId, (v) => v.activeFrame);
  const editingText = useViewState(refId, (v) => v.editingText);
  const fitted = useViewState(refId, (v) => v.fitted);
  const viewport = useViewState(refId, (v) => v.viewport);
  const rulers = useLayoutSession((s) => s.rulers);
  const guides = useLayoutSession((s) => s.guides);
  const grid = useLayoutSession((s) => s.grid);
  const gridSize = useLayoutSession((s) => s.gridSize);
  const theme = useUi((s) => s.theme);

  const rootRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<HTMLSpanElement>(null);
  const hCursor = useRef<HTMLDivElement>(null);
  const vCursor = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);
  const [snapGuides, setSnapGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [panning, setPanning] = useState(false);

  // viewport size + first fit
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width < 10 || height < 10) return;
      setViewState(refId, { viewport: { width, height } });
      if (!getViewState(refId).fitted) zoomToPage(refId);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [refId, !!layout]);

  // leaving the view ends frame activation / text editing
  useEffect(() => {
    if (!active) setViewState(refId, { activeFrame: null });
  }, [active, refId]);

  // page coordinates of a client point
  const toPage = useCallback(
    (clientX: number, clientY: number) => {
      const r = vpRef.current!.getBoundingClientRect();
      const v = getViewState(refId);
      return { x: (clientX - r.left - v.panX) / v.zoom, y: (clientY - r.top - v.panY) / v.zoom, vx: clientX - r.left, vy: clientY - r.top };
    },
    [refId],
  );

  // wheel: Ctrl = zoom around cursor, otherwise scroll the pasteboard
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest?.('.layout-frame-map') && getViewState(refId).activeFrame) return;
      e.preventDefault();
      const v = getViewState(refId);
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        zoomAt(refId, v.zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018)), { x: e.clientX - r.left, y: e.clientY - r.top });
      } else {
        const k = e.deltaMode === 1 ? 16 : 1;
        const dx = (e.shiftKey ? e.deltaY : e.deltaX) * k;
        const dy = (e.shiftKey ? 0 : e.deltaY) * k;
        setViewState(refId, { panX: v.panX - dx, panY: v.panY - dy });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [refId, !!layout]);

  // space-drag pan
  useEffect(() => {
    if (!active) return;
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]') && rootRef.current?.contains(document.activeElement)) {
        spaceRef.current = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [active]);

  if (!layout) return <Empty icon={FileText} title="Layout not found">This layout was deleted.</Empty>;

  const W = layout.page.width;
  const H = layout.page.height;
  const margin = marginOf(layout);
  const n = layout.elements.length;
  const selSet = new Set(selection);
  const singleSel = selection.length === 1 ? layout.elements.find((e) => e.id === selection[0]) : undefined;

  // ---------- pointer handling ----------

  const startWindowDrag = (move: (e: PointerEvent) => void, up: (e: PointerEvent) => void) => {
    let raf = 0;
    let last: PointerEvent | null = null;
    const onMove = (e: PointerEvent) => {
      last = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (last) move(last);
      });
    };
    const onUp = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      if (last) move(last);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      up(e);
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const others = (exclude: Set<Id>) =>
    getLayout(refId)!.elements.filter((e) => !exclude.has(e.id) && !e.props.hidden).map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h }));

  const onPointerDown = (e: React.PointerEvent) => {
    rootRef.current?.focus({ preventScroll: true });
    const target = e.target as HTMLElement;
    const v = getViewState(refId);
    // panning: middle button or space + left
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      e.preventDefault();
      dragRef.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: v.panX, py: v.panY };
      setPanning(true);
      startWindowDrag(
        (ev) => {
          const d = dragRef.current;
          if (d?.kind === 'pan') setViewState(refId, { panX: d.px + ev.clientX - d.sx, panY: d.py + ev.clientY - d.sy });
        },
        () => setPanning(false),
      );
      return;
    }
    if (e.button !== 0) return;
    const elNode = target.closest<HTMLElement>('[data-el-id]');
    const elId = elNode?.dataset.elId;
    if (v.activeFrame && elId === v.activeFrame && target.closest('.layout-frame-map')) return; // OL handles it
    if (v.activeFrame && elId !== v.activeFrame) setViewState(refId, { activeFrame: null });
    const l = getLayout(refId)!;
    const p = toPage(e.clientX, e.clientY);

    const handle = target.dataset.handle as Handle | undefined;
    if (handle && singleSel && !singleSel.props.locked) {
      e.preventDefault();
      dragRef.current = { kind: 'resize', sx: p.x, sy: p.y, before: l, id: singleSel.id, start: { x: singleSel.x, y: singleSel.y, w: singleSel.w, h: singleSel.h }, handle };
      startWindowDrag(
        (ev) => {
          const d = dragRef.current;
          if (d?.kind !== 'resize') return;
          const q = toPage(ev.clientX, ev.clientY);
          const cur = getLayout(refId)!.elements.find((x) => x.id === d.id);
          const keep = ev.shiftKey || (cur?.type === 'image' && cur.props.fit !== 'stretch' && !ev.ctrlKey);
          let r = resizeRect(d.start, d.handle, q.x - d.sx, q.y - d.sy, !!keep, 1);
          const s = useLayoutSession.getState();
          let gx: number | null = null;
          let gy: number | null = null;
          if (s.snap && !ev.altKey && !keep) {
            const z = getViewState(refId).zoom;
            const t = snapTargets(l.page, others(new Set([d.id])), s.guides ? marginOf(l) : 0);
            const thr = 6 / z;
            const snapX = (val: number) => (s.grid ? { value: snapToGrid(val, s.gridSize), guide: null } : snapValue(val, t.xs, thr));
            const snapY = (val: number) => (s.grid ? { value: snapToGrid(val, s.gridSize), guide: null } : snapValue(val, t.ys, thr));
            if (d.handle.includes('w')) {
              const sv = snapX(r.x);
              r = { ...r, w: r.w + r.x - sv.value, x: sv.value };
              gx = sv.guide;
            } else if (d.handle.includes('e')) {
              const sv = snapX(r.x + r.w);
              r = { ...r, w: sv.value - r.x };
              gx = sv.guide;
            }
            if (d.handle.includes('n')) {
              const sv = snapY(r.y);
              r = { ...r, h: r.h + r.y - sv.value, y: sv.value };
              gy = sv.guide;
            } else if (d.handle.includes('s')) {
              const sv = snapY(r.y + r.h);
              r = { ...r, h: sv.value - r.y };
              gy = sv.guide;
            }
            r.w = Math.max(1, r.w);
            r.h = Math.max(1, r.h);
          }
          setSnapGuides({ x: gx, y: gy });
          updateLayout(refId, (doc) => {
            const el = doc.elements.find((x) => x.id === d.id);
            if (el) Object.assign(el, { x: r.x, y: r.y, w: r.w, h: r.h });
          });
        },
        () => {
          const d = dragRef.current;
          setSnapGuides({ x: null, y: null });
          if (d?.kind === 'resize') recordUndo(refId, 'Resize Element', d.before, getLayout(refId)!);
        },
      );
      return;
    }

    if (elId) {
      const el = l.elements.find((x) => x.id === elId);
      if (!el) return;
      let sel = v.selection;
      if (e.shiftKey) sel = sel.includes(elId) ? sel.filter((s) => s !== elId) : [...sel, elId];
      else if (!sel.includes(elId)) sel = [elId];
      setSelectionIds(refId, sel);
      if (!sel.includes(elId)) return;
      const movers = l.elements.filter((x) => sel.includes(x.id) && !x.props.locked);
      if (!movers.length) return;
      e.preventDefault();
      const orig = new Map(movers.map((m) => [m.id, { x: m.x, y: m.y, w: m.w, h: m.h }]));
      const bounds = {
        x: Math.min(...movers.map((m) => m.x)), y: Math.min(...movers.map((m) => m.y)),
        w: Math.max(...movers.map((m) => m.x + m.w)) - Math.min(...movers.map((m) => m.x)),
        h: Math.max(...movers.map((m) => m.y + m.h)) - Math.min(...movers.map((m) => m.y)),
      };
      dragRef.current = { kind: 'move', sx: p.x, sy: p.y, started: false, before: l, orig, bounds };
      const exclude = new Set(orig.keys());
      const targets = snapTargets(l.page, others(exclude), useLayoutSession.getState().guides ? marginOf(l) : 0);
      startWindowDrag(
        (ev) => {
          const d = dragRef.current;
          if (d?.kind !== 'move') return;
          const q = toPage(ev.clientX, ev.clientY);
          const z = getViewState(refId).zoom;
          let dx = q.x - d.sx;
          let dy = q.y - d.sy;
          if (!d.started) {
            if (Math.hypot(dx * z, dy * z) < 3) return;
            d.started = true;
          }
          const s = useLayoutSession.getState();
          let gx: number | null = null;
          let gy: number | null = null;
          if (s.snap && !ev.altKey) {
            if (s.grid) {
              dx = snapToGrid(d.bounds.x + dx, s.gridSize) - d.bounds.x;
              dy = snapToGrid(d.bounds.y + dy, s.gridSize) - d.bounds.y;
            } else {
              const sn = snapMove({ ...d.bounds, x: d.bounds.x + dx, y: d.bounds.y + dy }, targets, 6 / z);
              dx += sn.dx;
              dy += sn.dy;
              gx = sn.guideX;
              gy = sn.guideY;
            }
          }
          setSnapGuides({ x: gx, y: gy });
          updateLayout(refId, (doc) => {
            for (const el of doc.elements) {
              const o = d.orig.get(el.id);
              if (o) {
                el.x = Math.round((o.x + dx) * 100) / 100;
                el.y = Math.round((o.y + dy) * 100) / 100;
              }
            }
          });
        },
        () => {
          const d = dragRef.current;
          setSnapGuides({ x: null, y: null });
          if (d?.kind === 'move' && d.started) recordUndo(refId, d.orig.size > 1 ? 'Move Elements' : 'Move Element', d.before, getLayout(refId)!);
          else if (d?.kind === 'move' && !e.shiftKey && sel.length > 1) setSelectionIds(refId, [elId]); // plain click inside a multi-selection
        },
      );
      return;
    }

    // empty page / pasteboard: marquee
    e.preventDefault();
    const base = e.shiftKey ? v.selection : [];
    if (!e.shiftKey) setSelectionIds(refId, []);
    dragRef.current = { kind: 'marquee', x0: p.x, y0: p.y, additive: e.shiftKey, base };
    startWindowDrag(
      (ev) => {
        const d = dragRef.current;
        if (d?.kind !== 'marquee') return;
        const q = toPage(ev.clientX, ev.clientY);
        const r = rectFromPoints(d.x0, d.y0, q.x, q.y);
        setMarquee(r);
        const hit = getLayout(refId)!.elements.filter((x) => !x.props.locked && !x.props.hidden && rectsIntersect(r, x)).map((x) => x.id);
        setSelectionIds(refId, [...new Set([...d.base, ...hit])]);
      },
      () => setMarquee(null),
    );
  };

  const onPointerMoveVp = (e: React.PointerEvent) => {
    const p = toPage(e.clientX, e.clientY);
    if (posRef.current) posRef.current.textContent = `X ${p.x.toFixed(1)}  Y ${p.y.toFixed(1)} mm`;
    if (hCursor.current) hCursor.current.style.left = p.vx + 'px';
    if (vCursor.current) vCursor.current.style.top = p.vy + 'px';
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-el-id]')?.dataset.elId;
    const el = id ? layout.elements.find((x) => x.id === id) : undefined;
    if (!el || el.props.locked) return;
    if (el.type === 'map') setViewState(refId, { activeFrame: el.id, selection: [el.id] });
    else if (el.type === 'text') setViewState(refId, { editingText: el.id, selection: [el.id] });
    else openPane('layout-element');
  };

  const onContextMenu = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.layout-frame-map') && activeFrame) return e.preventDefault();
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-el-id]')?.dataset.elId;
    let sel = getViewState(refId).selection;
    if (id && !sel.includes(id)) {
      sel = [id];
      setSelectionIds(refId, sel);
    }
    const has = sel.length > 0;
    const first = layout.elements.find((x) => x.id === sel[0]);
    const items: MenuItem[] = has
      ? [
          ...(first?.type === 'map' && sel.length === 1 ? [{ label: 'Activate Map Frame', onClick: () => setViewState(refId, { activeFrame: first.id }) }, 'separator' as const] : []),
          ...(first?.type === 'text' && sel.length === 1 ? [{ label: 'Edit Text', onClick: () => setViewState(refId, { editingText: first.id }) }, 'separator' as const] : []),
          { label: 'Cut', onClick: () => cutSelection(refId) },
          { label: 'Copy', onClick: () => copySelection(refId) },
          { label: 'Paste', onClick: () => paste(refId), disabled: !hasClipboard() },
          { label: 'Duplicate', onClick: () => duplicateSelection(refId) },
          'separator',
          { label: 'Bring to Front', onClick: () => reorder(refId, 'front') },
          { label: 'Bring Forward', onClick: () => reorder(refId, 'forward') },
          { label: 'Send Backward', onClick: () => reorder(refId, 'backward') },
          { label: 'Send to Back', onClick: () => reorder(refId, 'back') },
          'separator',
          { label: 'Lock', onClick: () => setLocked(refId, sel, true) },
          { label: 'Properties…', onClick: () => openPane('layout-element') },
          'separator',
          { label: 'Delete', danger: true, onClick: () => deleteSelection(refId) },
        ]
      : [
          { label: 'Paste', onClick: () => paste(refId), disabled: !hasClipboard() },
          { label: 'Select All', onClick: () => selectAll(refId) },
          'separator',
          { label: 'Zoom to Page', onClick: () => zoomToPage(refId) },
          { label: 'Page Setup…', onClick: () => openPane('layout-element') },
        ];
    showContextMenu(e, items);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    const v = getViewState(refId);
    const ctrl = e.ctrlKey || e.metaKey;
    let handled = true;
    if (e.key === 'Escape') {
      if (v.activeFrame) setViewState(refId, { activeFrame: null });
      else setSelectionIds(refId, []);
    } else if (v.activeFrame) handled = false;
    else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection(refId);
    else if (e.key.startsWith('Arrow') && !ctrl) {
      const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      nudge(refId, dx, dy);
    } else if (ctrl && e.key.toLowerCase() === 'a') selectAll(refId);
    else if (ctrl && e.key.toLowerCase() === 'c') copySelection(refId);
    else if (ctrl && e.key.toLowerCase() === 'x') cutSelection(refId);
    else if (ctrl && e.key.toLowerCase() === 'v') paste(refId);
    else if (ctrl && e.key.toLowerCase() === 'd') duplicateSelection(refId);
    else if (e.key === 'F2' && v.selection.length === 1) {
      const el = layout.elements.find((x) => x.id === v.selection[0]);
      if (el?.type === 'text') setViewState(refId, { editingText: el.id });
      else handled = false;
    } else if (e.key === 'Enter' && v.selection.length === 1) {
      const el = layout.elements.find((x) => x.id === v.selection[0]);
      if (el?.type === 'map') setViewState(refId, { activeFrame: el.id });
      else if (el?.type === 'text') setViewState(refId, { editingText: el.id });
      else handled = false;
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const pageStyle = { left: panX, top: panY, width: W * zoom, height: H * zoom };
  const percent = Math.round((zoom / NOMINAL_PX_PER_MM) * 100);
  const activeFrameEl = activeFrame ? layout.elements.find((x) => x.id === activeFrame) : undefined;

  return (
    <div ref={rootRef} className={`layout-view${rulers ? ' with-rulers' : ''}`} tabIndex={0} onKeyDown={onKeyDown}>
      {rulers && (
        <>
          <div className="layout-ruler-corner" title="Page origin (mm)" />
          <Ruler orient="h" length={viewport.width} offset={panX} zoom={zoom} theme={theme} cursorRef={hCursor} />
          <Ruler orient="v" length={viewport.height} offset={panY} zoom={zoom} theme={theme} cursorRef={vCursor} />
        </>
      )}
      <div
        ref={vpRef}
        className={`layout-viewport${panning ? ' panning' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMoveVp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onAuxClick={(e) => e.button === 1 && e.preventDefault()}
      >
        <div className="layout-page" style={pageStyle}>
          {grid && (
            <div className="layout-grid" style={{ backgroundSize: `${gridSize * zoom}px ${gridSize * zoom}px` }} />
          )}
          {layout.elements.map((el, i) => {
            if (el.props.hidden) return null;
            const isActiveFrame = el.id === activeFrame;
            return (
              <div
                key={el.id}
                data-el-id={el.id}
                className={`layout-el type-${el.type}${el.props.locked ? ' locked' : ''}${isActiveFrame ? ' activated' : ''}`}
                style={{ left: el.x * zoom, top: el.y * zoom, width: el.w * zoom, height: el.h * zoom, zIndex: isActiveFrame ? n + 5 : n - i }}
              >
                {el.type === 'map' ? (
                  <MapFrame layoutId={refId} el={el} zoom={zoom} active={isActiveFrame} />
                ) : (
                  <ElementCanvas el={el} layout={layout} zoom={zoom} />
                )}
                {editingText === el.id && el.type === 'text' && <TextEditor layoutId={refId} el={el} zoom={zoom} />}
              </div>
            );
          })}
          {guides && margin > 0 && (
            <div className="layout-margin" style={{ left: margin * zoom, top: margin * zoom, right: margin * zoom, bottom: margin * zoom, zIndex: n + 9 }} />
          )}
          <div className="layout-overlay" style={{ zIndex: n + 10 }}>
            {layout.elements.map((el) =>
              selSet.has(el.id) && !el.props.hidden ? (
                <div
                  key={el.id}
                  className={`layout-sel${el.props.locked ? ' locked' : ''}${el.id === activeFrame ? ' activated' : ''}`}
                  style={{ left: el.x * zoom, top: el.y * zoom, width: el.w * zoom, height: el.h * zoom }}
                >
                  {singleSel?.id === el.id && !el.props.locked && el.id !== activeFrame && editingText !== el.id &&
                    HANDLES.map((h) => <div key={h} className={`layout-handle h-${h}`} data-handle={h} />)}
                </div>
              ) : null,
            )}
            {snapGuides.x != null && <div className="layout-guide v" style={{ left: snapGuides.x * zoom }} />}
            {snapGuides.y != null && <div className="layout-guide h" style={{ top: snapGuides.y * zoom }} />}
            {marquee && (
              <div className="layout-marquee" style={{ left: marquee.x * zoom, top: marquee.y * zoom, width: marquee.w * zoom, height: marquee.h * zoom }} />
            )}
          </div>
          {activeFrameEl && (
            <div className="layout-framebar-anchor" style={{ left: activeFrameEl.x * zoom, top: (activeFrameEl.y + activeFrameEl.h) * zoom, zIndex: n + 20 }}>
              <FrameBar layoutId={refId} el={activeFrameEl} />
            </div>
          )}
        </div>
      </div>
      <div className="layout-status">
        <span ref={posRef} className="mono layout-pos" />
        <span className="muted">
          {W.toFixed(W % 1 ? 1 : 0)} × {H.toFixed(H % 1 ? 1 : 0)} mm
        </span>
        {selection.length > 0 && <span className="muted">{selection.length} selected</span>}
        {activeFrame && <span className="layout-status-hint">Map frame active: drag to pan, wheel to zoom, Alt+Shift+drag to rotate. Esc to finish.</span>}
        <span className="grow" />
        <IconButton icon={ZoomOut} title="Zoom Out" onClick={() => zoomStep(refId, -1)} />
        <button
          type="button"
          className="layout-zoom-pct"
          title="Zoom to 100% (actual size at 96 dpi)"
          onClick={() => zoomActual(refId)}
        >
          {percent}%
        </button>
        <IconButton icon={ZoomIn} title="Zoom In" onClick={() => zoomStep(refId, 1)} />
        <IconButton icon={Maximize} title="Zoom to Page" onClick={() => zoomToPage(refId)} />
        <IconButton icon={Scan} title="Zoom to Selection" disabled={!selection.length} onClick={() => zoomToSelection(refId)} />
      </div>
    </div>
  );
}

function zoomToSelection(layoutId: Id) {
  const l = getLayout(layoutId);
  const v = getViewState(layoutId);
  const els = l?.elements.filter((e) => v.selection.includes(e.id)) ?? [];
  if (!els.length) return;
  const x0 = Math.min(...els.map((e) => e.x));
  const y0 = Math.min(...els.map((e) => e.y));
  const x1 = Math.max(...els.map((e) => e.x + e.w));
  const y1 = Math.max(...els.map((e) => e.y + e.h));
  const zoom = clamp(Math.min((v.viewport.width - 60) / Math.max(1, x1 - x0), (v.viewport.height - 60) / Math.max(1, y1 - y0)), 0.2, 60);
  setViewState(layoutId, {
    zoom,
    panX: v.viewport.width / 2 - ((x0 + x1) / 2) * zoom,
    panY: v.viewport.height / 2 - ((y0 + y1) / 2) * zoom,
  });
}
