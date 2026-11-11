// Tool parameter form generated from ParamDefs.
import { useState, type ReactNode } from 'react';
import { Info, Plus, X } from 'lucide-react';
import { useDataset } from '../../core/data';
import { fieldRef, findFeatureLayer } from '../../core/store';
import { useSelection } from '../../core/ui';
import { Button, Checkbox, FieldSelect, IconButton, LayerSelect, NumberInput, Select, TextInput, cx, useFeatureLayers } from '../../ui/kit';
import { defaultValue } from './exec';
import { autoOutputName, geomMatches } from './runner';
import type { ParamDef, StatName, StatSpec, ToolDef } from './types';

const ALL_STATS: Array<{ value: StatName; label: string }> = [
  { value: 'sum', label: 'Sum' }, { value: 'mean', label: 'Mean' }, { value: 'min', label: 'Minimum' }, { value: 'max', label: 'Maximum' },
  { value: 'range', label: 'Range' }, { value: 'std', label: 'Standard deviation' }, { value: 'median', label: 'Median' },
  { value: 'count', label: 'Count' }, { value: 'first', label: 'First' }, { value: 'last', label: 'Last' },
];
const TEXT_STATS: StatName[] = ['count', 'first', 'last'];

interface Props {
  tool: ToolDef;
  params: Record<string, any>;
  errors: Record<string, string>;
  onChange(next: Record<string, any>): void;
  disabled?: boolean;
}

export function ToolForm({ tool, params, errors, onChange, disabled }: Props) {
  const setParam = (name: string, value: any) => {
    const next = { ...params, [name]: value };
    const def = tool.params.find((x) => x.name === name);
    if (def?.kind === 'layer')
      for (const q of tool.params) if ('layer' in q && q.layer === name) next[q.name] = defaultValue(q);
    onChange(next);
  };
  return (
    <div className="gp-form" aria-disabled={disabled}>
      {tool.params.map((p) => {
        if (p.showIf && !p.showIf(params)) return null;
        return (
          <ParamRow key={p.name} p={p} error={errors[p.name]}>
            <Control p={p} tool={tool} params={params} value={params[p.name]} onChange={(v) => setParam(p.name, v)} error={!!errors[p.name]} disabled={disabled} />
          </ParamRow>
        );
      })}
    </div>
  );
}

function ParamRow({ p, error, children }: { p: ParamDef; error?: string; children: ReactNode }) {
  const [help, setHelp] = useState(false);
  const required = !p.optional && (p.kind === 'layer' || p.kind === 'field') && !('allowNone' in p && p.allowNone);
  const isBool = p.kind === 'boolean';
  return (
    <div className={cx('gp-param', error && 'has-error')}>
      {!isBool && (
        <div className="gp-param-head">
          <label>
            {p.label}
            {required && <span className="gp-req" title="Required"> *</span>}
          </label>
          <button type="button" className={cx('gp-info', help && 'on')} title="Show help" aria-label={`Help for ${p.label}`} onClick={() => setHelp(!help)}>
            <Info size={12} />
          </button>
        </div>
      )}
      <div className={cx(isBool && 'gp-bool')}>
        {children}
        {isBool && (
          <button type="button" className={cx('gp-info', help && 'on')} title="Show help" aria-label={`Help for ${p.label}`} onClick={() => setHelp(!help)}>
            <Info size={12} />
          </button>
        )}
      </div>
      {error && <div className="gp-err">{error}</div>}
      {help && <div className="gp-help selectable">{p.help}</div>}
    </div>
  );
}

function SelectionNote({ layerId }: { layerId: string | undefined }) {
  const sel = useSelection(layerId);
  if (!sel.length) return null;
  return <div className="gp-note">{sel.length.toLocaleString()} selected feature{sel.length === 1 ? '' : 's'} will be processed.</div>;
}

function Control({
  p, tool, params, value, onChange, error, disabled,
}: { p: ParamDef; tool: ToolDef; params: Record<string, any>; value: any; onChange(v: any): void; error: boolean; disabled?: boolean }) {
  switch (p.kind) {
    case 'layer':
      return p.multiple ? (
        <LayerChecklist geom={p.geom} value={Array.isArray(value) ? value : []} onChange={onChange} />
      ) : (
        <div className="vstack" style={{ gap: 3 }}>
          <LayerSelect value={value} onChange={onChange} filter={(_l, ds) => geomMatches(p.geom, ds.geomType)} allowNone={p.optional} />
          <SelectionNote layerId={value} />
        </div>
      );
    case 'field': {
      const ds = findFeatureLayer(params[p.layer])?.dataset;
      return <FieldSelect datasetId={ds?.id} value={value} onChange={onChange} types={p.types} allowNone={p.optional || p.allowNone} />;
    }
    case 'fields': {
      const ds = findFeatureLayer(params[p.layer])?.dataset;
      return <FieldChecklist datasetId={ds?.id} types={p.types} value={Array.isArray(value) ? value : []} onChange={onChange} />;
    }
    case 'stats': {
      const ds = findFeatureLayer(params[p.layer])?.dataset;
      return <StatsEditor datasetId={ds?.id} types={p.types} value={Array.isArray(value) ? value : []} onChange={onChange} />;
    }
    case 'number':
      return <NumberInput value={value} onChange={onChange} min={p.min} max={p.max} step={p.step ?? (p.integer ? 1 : undefined)} />;
    case 'distance':
      return (
        <div className="hstack">
          <NumberInput value={value?.value} onChange={(n) => onChange({ ...value, value: n })} min={p.min} />
          <Select
            style={{ width: 96, flex: 'none' }}
            value={value?.unit}
            onChange={(u) => onChange({ ...value, unit: u })}
            options={[{ value: 'm', label: 'Meters' }, { value: 'km', label: 'Kilometers' }, { value: 'ft', label: 'Feet' }, { value: 'mi', label: 'Miles' }]}
          />
        </div>
      );
    case 'string':
      return <TextInput value={value ?? ''} onChange={onChange} placeholder={p.placeholder} invalid={error} />;
    case 'choice':
      return <Select value={value} onChange={onChange} options={p.options} />;
    case 'multichoice': {
      const cur: string[] = Array.isArray(value) ? value : [];
      return (
        <div className="gp-checklist">
          {p.options.map((o) => (
            <Checkbox key={o.value} checked={cur.includes(o.value)} label={o.label} onChange={(on) => onChange(on ? [...cur, o.value] : cur.filter((x) => x !== o.value))} />
          ))}
        </div>
      );
    }
    case 'boolean':
      return <Checkbox checked={!!value} onChange={onChange} label={p.label} />;
    case 'where': {
      const ds = findFeatureLayer(params[p.layer])?.dataset;
      return (
        <div className="vstack" style={{ gap: 4 }}>
          <textarea
            className={cx('textarea', error && 'invalid')}
            rows={3}
            spellCheck={false}
            value={value ?? ''}
            placeholder="e.g. POP > 1000000 AND NAME LIKE 'A%'"
            onChange={(e) => onChange(e.target.value)}
          />
          <Select
            value=""
            placeholder="Insert field…"
            disabled={!ds}
            onChange={(f) => onChange(`${value ?? ''}${value && !/\s$/.test(value) ? ' ' : ''}${fieldRef(f)}`)}
            options={(ds?.fields ?? []).map((f) => ({ value: f.name, label: f.name }))}
          />
        </div>
      );
    }
    case 'output':
      return <TextInput value={value ?? ''} onChange={onChange} placeholder={autoOutputName(tool, params)} disabled={disabled} />;
  }
}

function LayerChecklist({ geom, value, onChange }: { geom?: string[]; value: string[]; onChange(v: string[]): void }) {
  const layers = useFeatureLayers().filter((x) => geomMatches(geom, x.dataset.geomType));
  if (!layers.length) return <div className="muted">No compatible layers in the active map.</div>;
  return (
    <div className="gp-checklist">
      {layers.map(({ layer }) => (
        <Checkbox key={layer.id} checked={value.includes(layer.id)} label={layer.name} onChange={(on) => onChange(on ? [...value, layer.id] : value.filter((x) => x !== layer.id))} />
      ))}
    </div>
  );
}

function FieldChecklist({ datasetId, types, value, onChange }: { datasetId?: string; types?: string[]; value: string[]; onChange(v: string[]): void }) {
  const ds = useDataset(datasetId);
  const fields = (ds?.fields ?? []).filter((f) => !types || types.includes(f.type));
  if (!ds) return <div className="muted">Choose a layer first.</div>;
  if (!fields.length) return <div className="muted">No suitable fields.</div>;
  return (
    <div className="gp-checklist">
      {fields.map((f) => (
        <Checkbox key={f.name} checked={value.includes(f.name)} label={f.name} onChange={(on) => onChange(on ? [...value, f.name] : value.filter((x) => x !== f.name))} />
      ))}
    </div>
  );
}

function StatsEditor({ datasetId, types, value, onChange }: { datasetId?: string; types?: string[]; value: StatSpec[]; onChange(v: StatSpec[]): void }) {
  const ds = useDataset(datasetId);
  if (!ds) return <div className="muted">Choose a layer first.</div>;
  const fields = ds.fields.filter((f) => !types || types.includes(f.type));
  const patch = (i: number, p: Partial<StatSpec>) => onChange(value.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <div className="vstack" style={{ gap: 4 }}>
      {value.map((r, i) => {
        const isText = ds.fields.find((f) => f.name === r.field)?.type === 'string';
        const stats = isText ? ALL_STATS.filter((s) => TEXT_STATS.includes(s.value)) : ALL_STATS;
        return (
          <div className="hstack" key={i}>
            <div className="grow">
              <FieldSelect datasetId={datasetId} value={r.field} types={types as any} onChange={(f) => patch(i, { field: f })} />
            </div>
            <Select style={{ width: 118, flex: 'none' }} value={r.stat} onChange={(s) => patch(i, { stat: s })} options={stats} />
            <IconButton icon={X} title="Remove" onClick={() => onChange(value.filter((_, k) => k !== i))} />
          </div>
        );
      })}
      <div>
        <Button icon={Plus} disabled={!fields.length} onClick={() => onChange([...value, { field: fields[0]?.name ?? '', stat: 'sum' }])}>
          Add statistic
        </Button>
      </div>
    </div>
  );
}
