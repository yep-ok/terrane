// Shared UI kit. Feature modules build their panes/dialogs from these so the app
// looks consistent. Styling lives in ui/styles.css.
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import type { Dataset, Field, FieldType, Id, Layer } from '../core/types';
import { useDataset, getDataset } from '../core/data';
import { useMapDoc } from '../core/store';
import { useActiveMapId, useUi, type MenuItem } from '../core/ui';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

// ---------- buttons ----------

export function Button({
  variant = 'default', icon: Icon, children, className, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; icon?: LucideIcon }) {
  return (
    <button type="button" className={cx('btn', variant !== 'default' && variant, className)} {...rest}>
      {Icon && <Icon />}
      {children}
    </button>
  );
}

export function IconButton({
  icon: Icon, title, active, className, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; title: string; active?: boolean }) {
  return (
    <button type="button" className={cx('iconbtn', active && 'active', className)} title={title} aria-label={title} {...rest}>
      <Icon />
    </button>
  );
}

// ---------- inputs ----------

export function TextInput({
  value, onChange, onCommit, className, invalid, ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: string; onChange?: (v: string) => void; /** Fired on Enter / blur. */ onCommit?: (v: string) => void; invalid?: boolean;
}) {
  return (
    <input
      type="text"
      className={cx('input', invalid && 'invalid', className)}
      value={value}
      spellCheck={false}
      onChange={(e) => onChange?.(e.target.value)}
      onBlur={(e) => onCommit?.(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit?.((e.target as HTMLInputElement).value);
        rest.onKeyDown?.(e);
      }}
      {...rest}
    />
  );
}

/** Numeric input that keeps a local draft so partial text ("-", "1.") can be typed. */
export function NumberInput({
  value, onChange, min, max, step, className, style, disabled, placeholder,
}: {
  value: number | null | undefined; onChange: (v: number) => void; min?: number; max?: number; step?: number;
  className?: string; style?: CSSProperties; disabled?: boolean; placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    setDraft(null);
    let n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n)) return;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    if (n !== value) onChange(n);
  };
  return (
    <input
      type="number"
      className={cx('input', className)}
      style={style}
      disabled={disabled}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      value={draft ?? (value ?? '')}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max)) onChange(n);
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
    />
  );
}

export interface Option<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}
export function Select<T extends string = string>({
  value, onChange, options, className, style, disabled, placeholder,
}: {
  value: T | '' | null | undefined; onChange: (v: T) => void; options: Array<Option<T> | T>;
  className?: string; style?: CSSProperties; disabled?: boolean; /** Shown as a disabled first option when value is empty. */ placeholder?: string;
}) {
  return (
    <select className={cx('select', className)} style={style} disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value as T)}>
      {placeholder !== undefined && <option value="" disabled={!!placeholder}>{placeholder}</option>}
      {options.map((o) => {
        const opt = typeof o === 'string' ? { value: o, label: o } : o;
        return <option key={opt.value} value={opt.value} disabled={(opt as Option).disabled}>{opt.label}</option>;
      })}
    </select>
  );
}

export function Checkbox({ checked, onChange, label, disabled, title }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; title?: string }) {
  return (
    <label className="check" title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Slider({
  value, onChange, min = 0, max = 1, step = 0.01, format,
}: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; format?: (v: number) => string }) {
  return (
    <div className="slider">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="val">{format ? format(value) : value}</span>
    </div>
  );
}

export function ColorInput({ value, onChange, title }: { value: string; onChange: (v: string) => void; title?: string }) {
  return (
    <span className="color" title={title}>
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}

// ---------- layout helpers ----------

/** Labelled form row. `stacked` puts the label above the control. */
export function Row({ label, children, hint, stacked }: { label: ReactNode; children: ReactNode; hint?: ReactNode; stacked?: boolean }) {
  return (
    <div className={cx('row', stacked && 'stacked')}>
      <label>{label}</label>
      <div className="hstack" style={{ minWidth: 0 }}>{children}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Section({ title, children, defaultOpen = true, right }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <button type="button" className="section-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="grow">{title}</span>
        {right}
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: ReactNode }>; value: T; onChange: (id: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} type="button" className={cx('tab', t.id === value && 'active')} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon: Icon, title, children }: { icon?: LucideIcon; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      {Icon && <Icon />}
      {title && <div className="title">{title}</div>}
      {children}
    </div>
  );
}

export const Spinner = () => <span className="spinner" />;

// ---------- menus ----------

/** Open a popup menu anchored below an element (or at a mouse event with showContextMenu from core/ui). */
export function openMenuAt(anchor: Element, items: MenuItem[]) {
  const r = anchor.getBoundingClientRect();
  useUi.setState({ contextMenu: { x: r.left, y: r.bottom + 2, items } });
}

// ---------- domain pickers ----------

/** Feature layers of a map with their datasets (top-most first). */
export function useFeatureLayers(mapId?: Id | null): Array<{ layer: Extract<Layer, { kind: 'feature' }>; dataset: Dataset }> {
  const active = useActiveMapId();
  const doc = useMapDoc(mapId ?? active);
  useUi((s) => s.activeMapId); // re-evaluate on map switch
  const out: Array<{ layer: Extract<Layer, { kind: 'feature' }>; dataset: Dataset }> = [];
  for (const l of doc?.layers ?? []) {
    if (l.kind !== 'feature') continue;
    const dataset = getDataset(l.datasetId);
    if (dataset) out.push({ layer: l, dataset });
  }
  return out;
}

export function LayerSelect({
  value, onChange, mapId, filter, placeholder = 'Select a layer…', allowNone,
}: {
  value: Id | null | undefined; onChange: (layerId: Id) => void; mapId?: Id | null;
  filter?: (layer: Extract<Layer, { kind: 'feature' }>, ds: Dataset) => boolean; placeholder?: string; allowNone?: boolean;
}) {
  const layers = useFeatureLayers(mapId).filter((x) => !filter || filter(x.layer, x.dataset));
  return (
    <Select
      value={value ?? ''}
      onChange={onChange}
      placeholder={allowNone ? '' : placeholder}
      options={layers.map((x) => ({ value: x.layer.id, label: x.layer.name }))}
    />
  );
}

export function FieldSelect({
  datasetId, value, onChange, types, placeholder = 'Select a field…', allowNone, filter,
}: {
  datasetId: Id | null | undefined; value: string | null | undefined; onChange: (field: string) => void;
  /** Restrict to these field types. */ types?: FieldType[]; placeholder?: string; /** Adds an empty "<None>" choice. */ allowNone?: boolean;
  filter?: (f: Field) => boolean;
}) {
  const ds = useDataset(datasetId);
  const fields = (ds?.fields ?? []).filter((f) => (!types || types.includes(f.type)) && (!filter || filter(f)));
  const opts: Option[] = fields.map((f) => ({ value: f.name, label: f.alias ? `${f.alias} (${f.name})` : f.name }));
  if (allowNone) opts.unshift({ value: '', label: '<None>' });
  return <Select value={value ?? ''} onChange={onChange} placeholder={allowNone ? undefined : placeholder} options={opts} />;
}

export const NUMERIC: FieldType[] = ['number', 'integer'];

// ---------- misc hooks ----------

/** Debounced value. */
export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Element size via ResizeObserver. */
export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export function formatNumber(n: number, maxDigits = 2): string {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString(undefined, { maximumFractionDigits: maxDigits });
}

/** Trigger a browser download. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Show the native file picker and resolve with the chosen files. */
export function pickFiles(accept = '', multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}
