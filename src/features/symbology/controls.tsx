// Small reusable controls for the symbology pane: colour field, ramp picker, symbol editor.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { GeomType, MarkerShape, SymbolDef } from '../../core/types';
import { ColorInput, Row, Select, Slider, cx } from '../../ui/kit';
import { MarkerGlyph, SymbolSwatch } from './legend';
import { RAMPS, rampGradientCss, type ColorRamp } from './ramps';
import './symbology.css';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Colour swatch + hex entry. */
export function ColorField({ value, onChange, title }: { value: string; onChange: (v: string) => void; title?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (t: string) => {
    setDraft(null);
    const s = t.trim().startsWith('#') ? t.trim() : `#${t.trim()}`;
    if (/^#[0-9a-f]{6}$/i.test(s)) onChange(s.toLowerCase());
    else if (/^#[0-9a-f]{3}$/i.test(s)) onChange(('#' + [...s.slice(1)].map((c) => c + c).join('')).toLowerCase());
  };
  return (
    <span className="sy-colorfield">
      <ColorInput value={value} onChange={onChange} title={title} />
      <input
        className="input sy-hex"
        value={draft ?? value}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => draft !== null && commit(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
      />
    </span>
  );
}

/** Number input that only commits on Enter / blur (no live clamping while typing). */
export function CommitNumber({
  value, onCommit, min, max, step, width, disabled, title,
}: { value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; width?: number | string; disabled?: boolean; title?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (t: string) => {
    setDraft(null);
    let n = Number(t);
    if (t.trim() === '' || !Number.isFinite(n)) return;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    if (n !== value) onCommit(n);
  };
  return (
    <input
      type="number"
      className="input sy-num"
      style={width !== undefined ? { width } : undefined}
      value={draft ?? value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      title={title}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => draft !== null && commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

// ---------- ramp picker ----------

export function RampBar({ name, reverse, height = 12 }: { name: string; reverse?: boolean; height?: number }) {
  return <span className="sy-rampbar" style={{ background: rampGradientCss(name, reverse), height }} />;
}

export function RampPicker({
  value, onChange, kinds, reverse,
}: { value: string; onChange: (name: string) => void; kinds?: ColorRamp['kind'][]; reverse?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const groups: Array<[string, ColorRamp[]]> = [
    ['Sequential', RAMPS.filter((r) => r.kind === 'sequential')],
    ['Diverging', RAMPS.filter((r) => r.kind === 'diverging')],
    ['Qualitative', RAMPS.filter((r) => r.kind === 'qualitative')],
  ];
  return (
    <div className="sy-ramp" ref={ref}>
      <button type="button" className="sy-ramp-btn" onClick={() => setOpen(!open)} title={value}>
        <RampBar name={value} reverse={reverse} height={14} />
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="sy-ramp-pop">
          {groups.map(([title, list]) => {
            const shown = list.filter((r) => !kinds || kinds.includes(r.kind));
            if (!shown.length) return null;
            return (
              <div key={title}>
                <div className="sy-ramp-group">{title}</div>
                {shown.map((r) => (
                  <button
                    key={r.name}
                    type="button"
                    className={cx('sy-ramp-item', r.name === value && 'sel')}
                    onClick={() => {
                      onChange(r.name);
                      setOpen(false);
                    }}
                  >
                    <RampBar name={r.name} reverse={reverse} />
                    <span>{r.name}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- symbol editor ----------

export const DASH_PRESETS: Array<{ id: string; label: string; dash: number[] | undefined }> = [
  { id: 'solid', label: 'Solid', dash: undefined },
  { id: 'dash', label: 'Dashed', dash: [8, 5] },
  { id: 'long', label: 'Long dash', dash: [14, 6] },
  { id: 'dot', label: 'Dotted', dash: [2, 4] },
  { id: 'dashdot', label: 'Dash-dot', dash: [8, 4, 2, 4] },
];
const dashId = (d?: number[]) => {
  if (!d || !d.length) return 'solid';
  return DASH_PRESETS.find((p) => p.dash && p.dash.join() === d.join())?.id ?? 'custom';
};

export const SHAPES: Array<{ id: MarkerShape; label: string }> = [
  { id: 'circle', label: 'Circle' },
  { id: 'square', label: 'Square' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'star', label: 'Star' },
  { id: 'cross', label: 'Cross' },
  { id: 'x', label: 'X' },
];

export function ShapePicker({ value, onChange, symbol }: { value: MarkerShape; onChange: (s: MarkerShape) => void; symbol: SymbolDef }) {
  return (
    <div className="sy-shapes" role="radiogroup" aria-label="Marker shape">
      {SHAPES.map((s) => (
        <button key={s.id} type="button" role="radio" aria-checked={value === s.id} title={s.label} className={cx('sy-shape', value === s.id && 'on')} onClick={() => onChange(s.id)}>
          <svg width={18} height={18} viewBox="0 0 18 18">
            <MarkerGlyph symbol={{ ...symbol, shape: s.id, fill: 'currentColor', fillOpacity: 1, stroke: 'currentColor' }} cx={9} cy={9} r={5.5} strokeProps={{ stroke: 'currentColor', strokeWidth: 0.5 }} />
          </svg>
        </button>
      ))}
    </div>
  );
}

export interface SymbolEditorProps {
  symbol: SymbolDef;
  geomType: GeomType | null;
  onChange: (s: SymbolDef) => void;
  /** Hide the large preview (when embedded in a class row). */
  compact?: boolean;
  /** Hide size / shape controls (e.g. graduated colours on points keep them, proportional hides size). */
  hideSize?: boolean;
}

/** Edits every property of a SymbolDef that is relevant to the geometry family. */
export function SymbolEditor({ symbol, geomType, onChange, compact, hideSize }: SymbolEditorProps) {
  const set = (patch: Partial<SymbolDef>) => onChange({ ...symbol, ...patch });
  const isPoint = geomType === 'Point' || geomType === null;
  const isLine = geomType === 'LineString';
  const isPoly = geomType === 'Polygon';
  const strokeOpacity = symbol.strokeOpacity ?? 1;
  const dId = dashId(symbol.strokeDash);
  return (
    <div className="sy-editor">
      {!compact && (
        <div className="sy-preview">
          <SymbolSwatch symbol={symbol} geomType={geomType} width={64} height={32} />
        </div>
      )}
      {isPoint && (
        <>
          <Row label="Shape"><ShapePicker value={symbol.shape} onChange={(shape) => set({ shape })} symbol={symbol} /></Row>
          {!hideSize && (
            <Row label="Size">
              <CommitNumber value={symbol.size} min={1} max={60} step={0.5} width={64} onCommit={(size) => set({ size })} />
              <span className="muted">px radius</span>
            </Row>
          )}
          <Row label="Fill"><ColorField value={symbol.fill} onChange={(fill) => set({ fill })} /></Row>
          <Row label="Fill opacity"><Slider value={symbol.fillOpacity} onChange={(fillOpacity) => set({ fillOpacity })} format={pct} /></Row>
        </>
      )}
      {isPoly && (
        <>
          <Row label="Fill"><ColorField value={symbol.fill} onChange={(fill) => set({ fill })} /></Row>
          <Row label="Fill opacity"><Slider value={symbol.fillOpacity} onChange={(fillOpacity) => set({ fillOpacity })} format={pct} /></Row>
        </>
      )}
      <Row label={isLine ? 'Colour' : 'Outline'}>
        <ColorField
          value={symbol.stroke}
          onChange={(stroke) => set(isLine ? { stroke, fill: stroke } : { stroke })}
          title={isLine ? 'Line colour' : 'Outline colour'}
        />
      </Row>
      <Row label="Width">
        <CommitNumber value={symbol.strokeWidth} min={0} max={30} step={0.25} width={64} onCommit={(strokeWidth) => set({ strokeWidth })} />
        <span className="muted">px</span>
      </Row>
      {!isPoint && (
        <Row label="Dash">
          <Select
            value={dId}
            onChange={(id) => set({ strokeDash: DASH_PRESETS.find((p) => p.id === id)?.dash })}
            options={[...DASH_PRESETS.map((p) => ({ value: p.id, label: p.label })), ...(dId === 'custom' ? [{ value: 'custom', label: 'Custom' }] : [])]}
          />
        </Row>
      )}
      <Row label={isLine ? 'Opacity' : 'Outline opacity'}>
        <Slider value={strokeOpacity} onChange={(v) => set({ strokeOpacity: v })} format={pct} />
      </Row>
    </div>
  );
}
