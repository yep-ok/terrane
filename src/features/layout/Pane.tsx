// 'layout-element' pane: properties of the selected element(s), or page setup and the
// element list when nothing is selected.
import { useState, type ReactNode } from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp,
  Compass, Eye, EyeOff, FileText, Frame, GripVertical, Image as ImageIcon, ImagePlus, Lock, LockOpen, Map as MapIcon, Maximize,
  MousePointer2, Ruler, Square, TextAlignCenter, TextAlignEnd, TextAlignStart, Trash, Type, ListTree, ChartColumn, Crosshair,
  Braces,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Id, LayoutDoc, LayoutElement, LayoutElementType } from '../../core/types';
import { getDataset } from '../../core/data';
import { useLayoutDoc, useProject } from '../../core/store';
import { openMenuAt } from '../../ui/kit';
import {
  Button, Checkbox, ColorInput, Empty, IconButton, NumberInput, Row, Section, Select, TextInput, cx,
} from '../../ui/kit';
import { SymbolSwatch } from '../symbology/legend';
import { formatScale, parseScale, round, TOKENS } from './geometry';
import {
  align, chooseImage, deleteSelection, distribute, moveElementTo, reorder, setHidden, setLocked, setMeta, setPage, marginOf,
} from './actions';
import {
  patchElement, patchProps, setSelectionIds, setSessionFlag, setViewState, useActiveLayoutId, useLayoutSelection, useLayoutSession,
} from './session';
import { frameCrs, frameScale, zoomForScale } from './scale';
import { frameRuntimes } from './MapFrame';
import { legendContentHeight, legendLayers, NORTH_ARROWS } from './draw';
import { frameViewFor, TYPE_LABELS } from './elements';
import {
  FONT_FAMILIES, metaOf, PAGE_PRESETS, type ImageProps, type LegendProps, type MapFrameProps, type NorthArrowProps, type RectProps,
  type ScaleBarProps, type TextProps,
} from './types';
import { getMap } from '../../core/store';

export const TYPE_ICONS: Record<LayoutElementType, LucideIcon> = {
  map: MapIcon, text: Type, legend: ListTree, scalebar: Ruler, northarrow: Compass, rect: Square, image: ImageIcon, chart: ChartColumn,
};

export function LayoutElementPane() {
  const layoutId = useActiveLayoutId();
  const layout = useLayoutDoc(layoutId);
  const selection = useLayoutSelection(layoutId);
  if (!layoutId || !layout)
    return <Empty icon={Frame} title="No layout is active">Open a layout view to edit its page and elements.</Empty>;
  const selected = layout.elements.filter((e) => selection.includes(e.id));
  return (
    <>
      <div className="pane-toolbar layout-pane-toolbar">
        <span className="grow layout-pane-title">
          {selected.length === 0 ? layout.name : selected.length === 1 ? selected[0].name : `${selected.length} elements`}
        </span>
        {selected.length > 0 && (
          <>
            <IconButton icon={ArrowUpToLine} title="Bring to Front" onClick={() => reorder(layoutId, 'front')} />
            <IconButton icon={ChevronUp} title="Bring Forward" onClick={() => reorder(layoutId, 'forward')} />
            <IconButton icon={ChevronDown} title="Send Backward" onClick={() => reorder(layoutId, 'backward')} />
            <IconButton icon={ArrowDownToLine} title="Send to Back" onClick={() => reorder(layoutId, 'back')} />
            <IconButton icon={Trash} title="Delete" onClick={() => deleteSelection(layoutId)} />
            <IconButton icon={MousePointer2} title="Show page setup (clear selection)" onClick={() => setSelectionIds(layoutId, [])} />
          </>
        )}
      </div>
      <div className="pane-body layout-pane">
        {selected.length === 0 && (
          <>
            <PageSetup layout={layout} />
            <Section title={`Elements (${layout.elements.length})`}>
              <ElementList layout={layout} selection={selection} />
            </Section>
          </>
        )}
        {selected.length === 1 && <ElementProps layout={layout} el={selected[0]} />}
        {selected.length > 1 && <MultiProps layout={layout} els={selected} />}
      </div>
    </>
  );
}

// ---------- shared bits ----------

function ColorOrNone({ value, onChange, noneLabel = 'None', fallback = '#ffffff' }: { value: string; onChange: (v: string) => void; noneLabel?: string; fallback?: string }) {
  const on = !!value;
  return (
    <>
      <Checkbox checked={!on} onChange={(none) => onChange(none ? '' : fallback)} label={noneLabel} />
      {on && <ColorInput value={value} onChange={onChange} />}
    </>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; icon?: LucideIcon; label?: string; title: string }>; onChange: (v: T) => void }) {
  return (
    <div className="layout-seg">
      {options.map((o) => (
        <button key={o.value} type="button" title={o.title} className={cx('layout-seg-btn', value === o.value && 'active')} onClick={() => onChange(o.value)}>
          {o.icon ? <o.icon /> : o.label}
        </button>
      ))}
    </div>
  );
}

function FrameSelect({ layout, value, onChange }: { layout: LayoutDoc; value: Id; onChange: (id: Id) => void }) {
  const frames = layout.elements.filter((e) => e.type === 'map');
  return (
    <Select
      value={value}
      onChange={onChange}
      options={[{ value: '', label: frames.length ? `Automatic (${frames[0].name})` : 'No map frames' }, ...frames.map((f) => ({ value: f.id, label: f.name }))]}
    />
  );
}

const mm = (v: number) => round(v, 2);

/** Text field that edits a draft and commits on Enter / blur (Escape reverts). */
function CommitText({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <TextInput
      value={draft ?? value}
      onChange={setDraft}
      onCommit={(v) => {
        setDraft(null);
        const t = v.trim();
        if (t && t !== value) onCommit(t);
      }}
      onKeyDown={(e) => {
        // (kit TextInput's own Enter handler is replaced by a passed onKeyDown, so commit via blur)
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

// ---------- page setup ----------

function PageSetup({ layout }: { layout: LayoutDoc }) {
  const { width, height } = layout.page;
  const portrait = height >= width;
  const preset = PAGE_PRESETS.find((p) => (Math.abs(p.width - width) < 0.2 && Math.abs(p.height - height) < 0.2) || (Math.abs(p.width - height) < 0.2 && Math.abs(p.height - width) < 0.2));
  const [scaleEls, setScaleEls] = useState(true);
  const rulers = useLayoutSession((s) => s.rulers);
  const guides = useLayoutSession((s) => s.guides);
  const grid = useLayoutSession((s) => s.grid);
  const snap = useLayoutSession((s) => s.snap);
  const gridSize = useLayoutSession((s) => s.gridSize);
  const meta = metaOf(layout);
  const apply = (w: number, h: number) => setPage(layout.id, mm(w), mm(h), scaleEls);
  return (
    <>
      <Section title="Page">
        <Row label="Name">
          <CommitText value={layout.name} onCommit={(name) => setMeta(layout.id, { name }, 'Rename Layout')} />
        </Row>
        <Row label="Size">
          <Select
            value={preset?.id ?? 'custom'}
            onChange={(id) => {
              const p = PAGE_PRESETS.find((x) => x.id === id);
              if (p) apply(portrait ? p.width : p.height, portrait ? p.height : p.width);
            }}
            options={[...PAGE_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: 'custom', label: 'Custom' }]}
          />
        </Row>
        <Row label="Orientation">
          <Seg
            value={portrait ? 'portrait' : 'landscape'}
            onChange={(o) => (o === 'portrait') !== portrait && apply(height, width)}
            options={[
              { value: 'portrait', label: 'Portrait', title: 'Portrait' },
              { value: 'landscape', label: 'Landscape', title: 'Landscape' },
            ]}
          />
        </Row>
        <Row label="Width × height">
          <NumberInput value={mm(width)} min={20} max={2000} step={1} onChange={(v) => apply(v, height)} />
          <span className="muted">×</span>
          <NumberInput value={mm(height)} min={20} max={2000} step={1} onChange={(v) => apply(width, v)} />
          <span className="muted">mm</span>
        </Row>
        <Row label="">
          <Checkbox checked={scaleEls} onChange={setScaleEls} label="Scale elements with the page" />
        </Row>
        <Row label="Margin guides">
          <NumberInput value={marginOf(layout)} min={0} max={100} step={1} onChange={(v) => setMeta(layout.id, { margin: v })} />
          <span className="muted">mm</span>
        </Row>
        <Row label="Author" hint="Used by the {author} text token.">
          <TextInput value={meta.author ?? ''} onChange={(v) => setMeta(layout.id, { author: v }, 'Set Author')} />
        </Row>
      </Section>
      <Section title="Guides and snapping" defaultOpen={false}>
        <div className="vstack">
          <Checkbox checked={rulers} onChange={(v) => setSessionFlag('rulers', v)} label="Show rulers" />
          <Checkbox checked={guides} onChange={(v) => setSessionFlag('guides', v)} label="Show margin guides" />
          <Checkbox checked={snap} onChange={(v) => setSessionFlag('snap', v)} label="Snap to page, margins and elements (hold Alt to bypass)" />
          <div className="hstack">
            <Checkbox checked={grid} onChange={(v) => setSessionFlag('grid', v)} label="Show and snap to grid" />
            <NumberInput value={gridSize} min={1} max={50} step={1} style={{ width: 60 }} onChange={(v) => setSessionFlag('gridSize', v)} />
            <span className="muted">mm</span>
          </div>
        </div>
      </Section>
    </>
  );
}

// ---------- element list ----------

function ElementList({ layout, selection, reorderable = true }: { layout: LayoutDoc; selection: Id[]; reorderable?: boolean }) {
  const [renaming, setRenaming] = useState<Id | null>(null);
  const [dragId, setDragId] = useState<Id | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  if (!layout.elements.length) return <div className="muted layout-list-empty">The page is empty. Use the Insert group on the Layout tab to add elements.</div>;
  return (
    <div className="layout-list" onDragLeave={(e) => e.currentTarget === e.target && setDropAt(null)}>
      {layout.elements.map((el, i) => {
        const Icon = TYPE_ICONS[el.type];
        const sel = selection.includes(el.id);
        return (
          <div
            key={el.id}
            className={cx('layout-list-row', sel && 'selected', el.props.hidden && 'dim', dropAt === i && 'drop-before', dropAt === i + 1 && i === layout.elements.length - 1 && 'drop-after')}
            draggable={reorderable && renaming !== el.id}
            onDragStart={(e) => {
              setDragId(el.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', el.id);
            }}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              setDropAt(e.clientY < r.top + r.height / 2 ? i : i + 1);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId && dropAt != null) moveElementTo(layout.id, dragId, dropAt);
              setDragId(null);
              setDropAt(null);
            }}
            onDragEnd={() => {
              setDragId(null);
              setDropAt(null);
            }}
            onClick={(e) => {
              setSelectionIds(layout.id, e.shiftKey ? (sel ? selection.filter((s) => s !== el.id) : [...selection, el.id]) : [el.id]);
            }}
            onDoubleClick={() => setRenaming(el.id)}
          >
            <GripVertical className="layout-grip" />
            <Icon className="layout-list-icon" />
            {renaming === el.id ? (
              <input
                className="input"
                autoFocus
                defaultValue={el.name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== el.name) patchElement(layout.id, el.id, { name: v }, 'Rename Element');
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <span className="grow layout-list-name" title={`${TYPE_LABELS[el.type]}: ${el.name}`}>{el.name}</span>
            )}
            <IconButton
              icon={el.props.hidden ? EyeOff : Eye}
              title={el.props.hidden ? 'Show' : 'Hide'}
              className={cx(!el.props.hidden && 'layout-list-quiet')}
              onClick={(e) => {
                e.stopPropagation();
                setHidden(layout.id, [el.id], !el.props.hidden);
              }}
            />
            <IconButton
              icon={el.props.locked ? Lock : LockOpen}
              title={el.props.locked ? 'Unlock' : 'Lock'}
              className={cx(!el.props.locked && 'layout-list-quiet')}
              onClick={(e) => {
                e.stopPropagation();
                setLocked(layout.id, [el.id], !el.props.locked);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ---------- multi selection ----------

function AlignButtons({ layoutId, count }: { layoutId: Id; count: number }) {
  return (
    <div className="hstack layout-align">
      <IconButton icon={AlignStartVertical} title={count > 1 ? 'Align Left' : 'Align Left to Page'} onClick={() => align(layoutId, 'left')} />
      <IconButton icon={AlignCenterVertical} title="Align Centre" onClick={() => align(layoutId, 'hcenter')} />
      <IconButton icon={AlignEndVertical} title="Align Right" onClick={() => align(layoutId, 'right')} />
      <span className="layout-sep" />
      <IconButton icon={AlignStartHorizontal} title="Align Top" onClick={() => align(layoutId, 'top')} />
      <IconButton icon={AlignCenterHorizontal} title="Align Middle" onClick={() => align(layoutId, 'vcenter')} />
      <IconButton icon={AlignEndHorizontal} title="Align Bottom" onClick={() => align(layoutId, 'bottom')} />
      {count > 2 && (
        <>
          <span className="layout-sep" />
          <IconButton icon={AlignHorizontalDistributeCenter} title="Distribute Horizontally" onClick={() => distribute(layoutId, 'h')} />
          <IconButton icon={AlignVerticalDistributeCenter} title="Distribute Vertically" onClick={() => distribute(layoutId, 'v')} />
        </>
      )}
    </div>
  );
}

function MultiProps({ layout, els }: { layout: LayoutDoc; els: LayoutElement[] }) {
  const ids = els.map((e) => e.id);
  const allLocked = els.every((e) => e.props.locked);
  const allHidden = els.every((e) => e.props.hidden);
  return (
    <>
      <Section title="Arrange">
        <AlignButtons layoutId={layout.id} count={els.length} />
        <div className="hstack" style={{ marginTop: 8 }}>
          <Checkbox checked={allLocked} onChange={(v) => setLocked(layout.id, ids, v)} label="Locked" />
          <Checkbox checked={allHidden} onChange={(v) => setHidden(layout.id, ids, v)} label="Hidden" />
        </div>
      </Section>
      <Section title="Selection">
        <ElementList layout={{ ...layout, elements: els }} selection={ids} reorderable={false} />
      </Section>
    </>
  );
}

// ---------- single element ----------

function ElementProps({ layout, el }: { layout: LayoutDoc; el: LayoutElement }) {
  const lid = layout.id;
  const geo = (patch: Partial<LayoutElement>) => patchElement(lid, el.id, patch, 'Move / Resize');
  let body: ReactNode = null;
  switch (el.type) {
    case 'map': body = <MapFrameSection layout={layout} el={el} />; break;
    case 'text': body = <TextSection layout={layout} el={el} />; break;
    case 'legend': body = <LegendSection layout={layout} el={el} />; break;
    case 'scalebar': body = <ScaleBarSection layout={layout} el={el} />; break;
    case 'northarrow': body = <NorthArrowSection layout={layout} el={el} />; break;
    case 'rect': body = <RectSection layout={layout} el={el} />; break;
    case 'image': body = <ImageSection layout={layout} el={el} />; break;
    case 'chart': body = <Section title="Chart"><div className="muted">Chart elements are not editable on layouts yet.</div></Section>; break;
  }
  return (
    <>
      {body}
      <Section title="Position and size">
        <Row label="Name">
          <CommitText key={el.id} value={el.name} onCommit={(name) => patchElement(lid, el.id, { name }, 'Rename Element')} />
        </Row>
        <Row label="X / Y (mm)">
          <NumberInput value={mm(el.x)} step={0.5} onChange={(x) => geo({ x })} />
          <NumberInput value={mm(el.y)} step={0.5} onChange={(y) => geo({ y })} />
        </Row>
        <Row label="Width / height">
          <NumberInput value={mm(el.w)} min={1} step={0.5} onChange={(w) => geo({ w })} />
          <NumberInput value={mm(el.h)} min={1} step={0.5} onChange={(h) => geo({ h })} />
        </Row>
        <Row label="Align to page">
          <AlignButtons layoutId={lid} count={1} />
        </Row>
        <Row label="">
          <Checkbox checked={!!el.props.locked} onChange={(v) => setLocked(lid, [el.id], v)} label="Locked" />
          <Checkbox checked={!!el.props.hidden} onChange={(v) => setHidden(lid, [el.id], v)} label="Hidden" />
        </Row>
      </Section>
    </>
  );
}

type SectionProps = { layout: LayoutDoc; el: LayoutElement };

function MapFrameSection({ layout, el }: SectionProps) {
  const p = el.props as MapFrameProps;
  const maps = useProject((s) => s.project.maps);
  const set = (props: Partial<MapFrameProps>, label = 'Edit Map Frame') => patchProps(layout.id, el.id, props, label);
  const scale = frameScale(el);
  const [draft, setDraft] = useState<string | null>(null);
  const map = getMap(p.mapId);
  const commitScale = (text: string) => {
    setDraft(null);
    const s = parseScale(text);
    const zoom = s ? zoomForScale(p.view, frameCrs(map), s) : null;
    if (zoom != null) set({ view: { ...p.view, zoom } }, 'Set Map Frame Scale');
  };
  const rotation = round(((p.view?.rotation ?? 0) * 180) / Math.PI, 2);
  return (
    <Section title="Map frame">
      <Row label="Map">
        <Select
          value={p.mapId}
          onChange={(mapId) => {
            const m = getMap(mapId);
            if (m) set({ mapId, view: frameViewFor(m, el.w, el.h) }, 'Change Frame Map');
          }}
          placeholder={map ? undefined : 'Missing map'}
          options={maps.map((m) => ({ value: m.id, label: m.name }))}
        />
      </Row>
      <Row label="Scale">
        <input
          className="input mono"
          value={draft ?? formatScale(scale)}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => draft != null && commitScale(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </Row>
      <Row label="Rotation (°)">
        <NumberInput value={rotation} step={1} min={-360} max={360} onChange={(deg) => set({ view: { ...p.view, rotation: (deg * Math.PI) / 180 } }, 'Rotate Map Frame')} />
      </Row>
      <Row label="Extent">
        <Button icon={Crosshair} title="Interactively pan and zoom the map inside the frame" onClick={() => setViewState(layout.id, { activeFrame: el.id })}>Activate</Button>
        <Button icon={Maximize} title="Zoom the frame to all of its layers" onClick={() => frameRuntimes.get(el.id)?.zoomFull()}>Full</Button>
        <Button title="Use the extent shown in the map's own view" disabled={!map} onClick={() => map && set({ view: frameViewFor(map, el.w, el.h) }, 'Match Map View')}>Match map</Button>
      </Row>
      <Row label="Border">
        <ColorOrNone fallback="#1b1b1b" value={p.borderWidth > 0 ? p.borderColor : ''} onChange={(c) => set(c ? { borderColor: c, borderWidth: p.borderWidth > 0 ? p.borderWidth : 0.35 } : { borderWidth: 0 })} />
        {p.borderWidth > 0 && <NumberInput value={p.borderWidth} min={0.05} max={10} step={0.05} style={{ width: 64 }} onChange={(borderWidth) => set({ borderWidth })} />}
      </Row>
      <Row label="Background">
        <ColorOrNone value={p.background} onChange={(background) => set({ background })} />
      </Row>
    </Section>
  );
}

function FontRows({ size, family, color, onChange }: { size: number; family: string; color: string; onChange: (p: { fontSize?: number; fontFamily?: string; color?: string }) => void }) {
  return (
    <>
      <Row label="Font">
        <Select value={family} onChange={(fontFamily) => onChange({ fontFamily })} options={FONT_FAMILIES} />
      </Row>
      <Row label="Size (pt) / colour">
        <NumberInput value={size} min={2} max={400} step={0.5} style={{ width: 70 }} onChange={(fontSize) => onChange({ fontSize })} />
        <ColorInput value={color} onChange={(c) => onChange({ color: c })} />
      </Row>
    </>
  );
}

function TextSection({ layout, el }: SectionProps) {
  const p = el.props as TextProps;
  const set = (props: Partial<TextProps>) => patchProps(layout.id, el.id, props, 'Edit Text');
  const [draft, setDraft] = useState<string | null>(null);
  const insertToken = (anchor: Element) =>
    openMenuAt(anchor, TOKENS.map((t) => ({ label: `${t.token}  ${t.description}`, onClick: () => set({ text: (draft ?? p.text) + t.token }) })));
  return (
    <Section title="Text">
      <div className="layout-textarea-wrap">
        <textarea
          className="textarea layout-textarea"
          rows={4}
          value={draft ?? p.text}
          onChange={(e) => {
            setDraft(e.target.value);
            set({ text: e.target.value });
          }}
          onBlur={() => setDraft(null)}
        />
        <Button icon={Braces} className="layout-token-btn" title="Insert a dynamic text token" onClick={(e) => insertToken(e.currentTarget)}>Token</Button>
      </div>
      <FontRows size={p.fontSize} family={p.fontFamily} color={p.color} onChange={set} />
      <Row label="Style">
        <div className="layout-seg">
          <button type="button" className={cx('layout-seg-btn', p.bold && 'active')} title="Bold" onClick={() => set({ bold: !p.bold })}><b>B</b></button>
          <button type="button" className={cx('layout-seg-btn', p.italic && 'active')} title="Italic" onClick={() => set({ italic: !p.italic })}><i>I</i></button>
        </div>
        <Seg value={p.align} onChange={(align) => set({ align })} options={[
          { value: 'left', icon: TextAlignStart, title: 'Align left' },
          { value: 'center', icon: TextAlignCenter, title: 'Centre' },
          { value: 'right', icon: TextAlignEnd, title: 'Align right' },
        ]} />
      </Row>
      <Row label="Vertical">
        <Seg value={p.vAlign} onChange={(vAlign) => set({ vAlign })} options={[
          { value: 'top', label: 'Top', title: 'Top' },
          { value: 'middle', label: 'Middle', title: 'Middle' },
          { value: 'bottom', label: 'Bottom', title: 'Bottom' },
        ]} />
      </Row>
      <Row label="Line spacing">
        <NumberInput value={p.lineHeight} min={0.8} max={3} step={0.05} onChange={(lineHeight) => set({ lineHeight })} />
      </Row>
      <Row label="Background">
        <ColorOrNone value={p.background} onChange={(background) => set({ background })} />
      </Row>
      <Row label="Padding (mm)">
        <NumberInput value={p.padding} min={0} max={50} step={0.5} onChange={(padding) => set({ padding })} />
      </Row>
    </Section>
  );
}

function LegendSection({ layout, el }: SectionProps) {
  const p = el.props as LegendProps;
  const set = (props: Partial<LegendProps>) => patchProps(layout.id, el.id, props, 'Edit Legend');
  useProject((s) => s.project.maps); // layer list follows the map
  const layers = legendLayers(layout, el);
  const auto = p.layerIds == null;
  const included = new Set(p.layerIds ?? layers.map((l) => l.id));
  return (
    <>
      <Section title="Legend">
        <Row label="Map frame">
          <FrameSelect layout={layout} value={p.frameId} onChange={(frameId) => set({ frameId })} />
        </Row>
        <Row label="Title">
          <TextInput value={p.title} onChange={(title) => set({ title })} placeholder="No title" />
        </Row>
        <Row label="Columns">
          <NumberInput value={p.columns} min={1} max={8} step={1} onChange={(columns) => set({ columns })} />
        </Row>
        <FontRows size={p.fontSize} family={p.fontFamily} color={p.color} onChange={set} />
        <Row label="">
          <Checkbox checked={p.showLayerNames} onChange={(showLayerNames) => set({ showLayerNames })} label="Show layer names" />
        </Row>
        <Row label="Border">
          <ColorOrNone fallback="#1b1b1b" value={p.borderWidth > 0 ? p.borderColor : ''} onChange={(c) => set(c ? { borderColor: c, borderWidth: p.borderWidth > 0 ? p.borderWidth : 0.2 } : { borderWidth: 0 })} />
          {p.borderWidth > 0 && <NumberInput value={p.borderWidth} min={0.05} max={5} step={0.05} style={{ width: 64 }} onChange={(borderWidth) => set({ borderWidth })} />}
        </Row>
        <Row label="Background">
          <ColorOrNone value={p.background} onChange={(background) => set({ background })} />
        </Row>
        <Row label="Padding (mm)">
          <NumberInput value={p.padding} min={0} max={20} step={0.5} onChange={(padding) => set({ padding })} />
        </Row>
        <Row label="">
          <Button title="Set the height so every item fits" onClick={() => patchElement(layout.id, el.id, { h: round(Math.max(5, legendContentHeight(layout, el)), 1) }, 'Fit Legend')}>
            Fit height to content
          </Button>
        </Row>
      </Section>
      <Section title="Items">
        <Checkbox checked={auto} onChange={(v) => set({ layerIds: v ? null : layers.map((l) => l.id) })} label="All visible layers (follows the map)" />
        <div className="layout-legend-layers">
          {layers.length === 0 && <div className="muted">The linked map has no visible feature layers.</div>}
          {layers.map((l) => {
            const ds = getDataset(l.datasetId);
            const sym = l.renderer.type === 'single' ? l.renderer.symbol : l.renderer.type === 'unique' ? l.renderer.classes[0]?.symbol : l.renderer.type === 'graduated' ? l.renderer.classes[0]?.symbol : l.renderer.type === 'proportional' ? l.renderer.symbol : undefined;
            return (
              <label key={l.id} className={cx('layout-legend-layer', auto && 'dim')}>
                <input
                  type="checkbox"
                  disabled={auto}
                  checked={included.has(l.id)}
                  onChange={(e) => {
                    const next = new Set(included);
                    if (e.target.checked) next.add(l.id);
                    else next.delete(l.id);
                    set({ layerIds: layers.filter((x) => next.has(x.id)).map((x) => x.id) });
                  }}
                />
                {sym ? <SymbolSwatch symbol={sym} geomType={ds?.geomType ?? null} /> : <span className="layout-swatch-gap" />}
                <span className="grow layout-list-name">{l.name}</span>
              </label>
            );
          })}
        </div>
      </Section>
    </>
  );
}

function ScaleBarSection({ layout, el }: SectionProps) {
  const p = el.props as ScaleBarProps;
  const set = (props: Partial<ScaleBarProps>) => patchProps(layout.id, el.id, props, 'Edit Scale Bar');
  useProject((s) => s.project.maps);
  return (
    <Section title="Scale bar">
      <Row label="Map frame">
        <FrameSelect layout={layout} value={p.frameId} onChange={(frameId) => set({ frameId })} />
      </Row>
      <Row label="Style">
        <Select value={p.style} onChange={(style) => set({ style })} options={[
          { value: 'bar', label: 'Alternating bar' },
          { value: 'line', label: 'Single line with ticks' },
          { value: 'text', label: 'Scale text (1:50,000)' },
        ]} />
      </Row>
      {p.style !== 'text' && (
        <>
          <Row label="Units">
            <Seg value={p.units} onChange={(units) => set({ units })} options={[
              { value: 'metric', label: 'Metric', title: 'Metres / kilometres' },
              { value: 'imperial', label: 'Imperial', title: 'Feet / miles' },
            ]} />
          </Row>
          <Row label="Divisions">
            <NumberInput value={p.divisions} min={1} max={10} step={1} onChange={(divisions) => set({ divisions })} />
          </Row>
        </>
      )}
      <FontRows size={p.fontSize} family={p.fontFamily} color={p.color} onChange={set} />
      <Row label="Background">
        <ColorOrNone value={p.background} onChange={(background) => set({ background })} />
      </Row>
    </Section>
  );
}

function NorthArrowSection({ layout, el }: SectionProps) {
  const p = el.props as NorthArrowProps;
  const set = (props: Partial<NorthArrowProps>) => patchProps(layout.id, el.id, props, 'Edit North Arrow');
  return (
    <Section title="North arrow">
      <Row label="Map frame" hint="The arrow rotates with the frame's map rotation.">
        <FrameSelect layout={layout} value={p.frameId} onChange={(frameId) => set({ frameId })} />
      </Row>
      <Row label="Design">
        <Select value={p.design} onChange={(design) => set({ design })} options={NORTH_ARROWS.map((d) => ({ value: d.id, label: d.label }))} />
      </Row>
      <Row label="Colour">
        <ColorInput value={p.color} onChange={(color) => set({ color })} />
      </Row>
      <Row label="Background">
        <ColorOrNone value={p.background} onChange={(background) => set({ background })} />
      </Row>
    </Section>
  );
}

function RectSection({ layout, el }: SectionProps) {
  const p = el.props as RectProps;
  const set = (props: Partial<RectProps>) => patchProps(layout.id, el.id, props, 'Edit Rectangle');
  return (
    <Section title="Rectangle">
      <Row label="Fill">
        <ColorOrNone value={p.fill} onChange={(fill) => set({ fill })} />
      </Row>
      <Row label="Outline">
        <ColorOrNone value={p.stroke} fallback="#1b1b1b" onChange={(stroke) => set({ stroke, strokeWidth: p.strokeWidth > 0 ? p.strokeWidth : 0.5 })} />
        {p.stroke && <NumberInput value={p.strokeWidth} min={0.05} max={20} step={0.05} style={{ width: 64 }} onChange={(strokeWidth) => set({ strokeWidth })} />}
      </Row>
      <Row label="Corner radius">
        <NumberInput value={p.radius} min={0} max={100} step={0.5} onChange={(radius) => set({ radius })} />
        <span className="muted">mm</span>
      </Row>
      <Row label="">
        <Button
          title="Make this rectangle a neatline around the page margins"
          onClick={() => {
            const m = marginOf(layout);
            patchElement(layout.id, el.id, { x: m, y: m, w: layout.page.width - 2 * m, h: layout.page.height - 2 * m }, 'Neatline');
          }}
        >
          Fit to margins (neatline)
        </Button>
      </Row>
    </Section>
  );
}

function ImageSection({ layout, el }: SectionProps) {
  const p = el.props as ImageProps;
  const set = (props: Partial<ImageProps>) => patchProps(layout.id, el.id, props, 'Edit Picture');
  return (
    <Section title="Picture">
      <Row label="File">
        <Button icon={ImagePlus} onClick={async () => {
          const img = await chooseImage();
          if (img) set({ src: img.src, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
        }}>
          {p.src ? 'Replace…' : 'Choose…'}
        </Button>
        {p.naturalWidth > 0 && <span className="muted">{p.naturalWidth} × {p.naturalHeight} px</span>}
      </Row>
      <Row label="Fit">
        <Select value={p.fit} onChange={(fit) => set({ fit })} options={[
          { value: 'contain', label: 'Keep aspect ratio' },
          { value: 'stretch', label: 'Stretch to frame' },
        ]} />
      </Row>
      <Row label="">
        <Button
          disabled={!p.naturalWidth}
          title="Resize the frame to the picture's aspect ratio"
          onClick={() => patchElement(layout.id, el.id, { h: round((el.w * p.naturalHeight) / p.naturalWidth, 2) }, 'Reset Aspect')}
        >
          Reset aspect ratio
        </Button>
      </Row>
    </Section>
  );
}
