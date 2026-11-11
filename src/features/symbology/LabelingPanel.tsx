// Labeling tab: label expression, font, halo, placement and zoom range.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, X } from 'lucide-react';
import type { Dataset, FeatureLayer, LabelDef } from '../../core/types';
import { updateLayer, defaultLabels, fieldRef } from '../../core/store';
import { tryCompile } from '../../core/expr';
import { getMapHandle } from '../../map/handle';
import { Checkbox, IconButton, Row, Select } from '../../ui/kit';
import { ColorField, CommitNumber } from './controls';
import './symbology.css';

const FONTS = [
  { value: '', label: 'Default (UI sans)' },
  { value: 'Georgia, serif', label: 'Serif' },
  { value: "'Cascadia Mono', Consolas, monospace", label: 'Monospace' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: "'Trebuchet MS', sans-serif", label: 'Trebuchet' },
];

export function LabelingPanel({ layer, ds }: { layer: FeatureLayer; ds: Dataset }) {
  const labels = layer.labels;
  const geom = ds.geomType;
  const set = (patch: Partial<LabelDef>) => updateLayer<FeatureLayer>(layer.id, { labels: { ...labels, ...patch } });

  // Expression editing keeps a local draft; valid drafts are applied live.
  const [expr, setExpr] = useState(labels.expression);
  const committed = useRef(labels.expression);
  useEffect(() => {
    if (labels.expression !== committed.current) {
      committed.current = labels.expression;
      setExpr(labels.expression);
    }
  }, [labels.expression]);
  const compiled = useMemo(() => tryCompile(expr), [expr]);
  const samples = useMemo(() => {
    if (!compiled.fn) return [];
    const out: string[] = [];
    for (const f of ds.features) {
      if (out.length >= 3) break;
      try {
        const v = compiled.fn(f);
        if (v !== null && v !== undefined && String(v) !== '') out.push(String(v));
      } catch {}
    }
    return out;
  }, [compiled, ds.features]);
  const area = useRef<HTMLTextAreaElement>(null);
  const edit = (text: string) => {
    setExpr(text);
    if (tryCompile(text).fn) {
      committed.current = text;
      set({ expression: text });
    }
  };
  const insertField = (name: string) => {
    const ta = area.current;
    const ref = fieldRef(name);
    if (!ta) return edit(expr + ref);
    const a = ta.selectionStart ?? expr.length;
    const b = ta.selectionEnd ?? a;
    edit(expr.slice(0, a) + ref + expr.slice(b));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(a + ref.length, a + ref.length);
    });
  };
  const enable = (enabled: boolean) => {
    const next: LabelDef = { ...labels, enabled };
    if (enabled && !labels.expression.trim()) next.expression = defaultLabels(ds).expression;
    updateLayer<FeatureLayer>(layer.id, { labels: next });
  };
  const currentZoom = () => Math.round((getMapHandle()?.getViewState().zoom ?? 0) * 10) / 10;
  const font = `${labels.italic ? 'italic ' : ''}${labels.bold ? 'bold ' : ''}${labels.fontSize}px ${labels.fontFamily || "'Segoe UI', system-ui, sans-serif"}`;
  const halo = labels.haloWidth > 0 ? Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; return `${(Math.cos(a) * labels.haloWidth).toFixed(1)}px ${(Math.sin(a) * labels.haloWidth).toFixed(1)}px 0 ${labels.haloColor}`; }).join(',') : 'none';
  const disabled = !labels.enabled;

  return (
    <>
      <Checkbox checked={labels.enabled} onChange={enable} label={<b>Label features</b>} />
      <div style={{ opacity: disabled ? 0.55 : 1, pointerEvents: disabled ? 'none' : undefined, marginTop: 8 }}>
        <div className="sy-label-sample">
          <span style={{ font, color: labels.color, textShadow: halo, fontWeight: labels.bold ? 700 : undefined }}>{samples[0] ?? 'Sample label'}</span>
        </div>

        <div className="sy-sub">Expression <span className="grow" /></div>
        <textarea
          ref={area}
          className={`textarea${compiled.error ? ' invalid' : ''}`}
          rows={3}
          value={expr}
          spellCheck={false}
          placeholder={'NAME  or  NAME + " (" + Round(POP / 1e6, 1) + "M)"'}
          onChange={(e) => edit(e.target.value)}
          style={{ width: '100%' }}
        />
        <div className="sy-expr-tools">
          <Select
            value=""
            placeholder="Insert field…"
            onChange={insertField}
            options={ds.fields.map((f) => ({ value: f.name, label: f.alias ? `${f.alias} (${f.name})` : f.name }))}
          />
        </div>
        <div className={`sy-expr-status ${compiled.error ? 'bad' : 'ok'}`}>{compiled.error ? compiled.error : expr.trim() ? 'Expression is valid.' : 'Enter a field name or expression.'}</div>
        {samples.length > 1 && (
          <div className="sy-samples">{samples.map((s, i) => <div key={i}>{s}</div>)}</div>
        )}

        <div className="sy-sub">Font <span className="grow" /></div>
        <Row label="Family"><Select value={labels.fontFamily ?? ''} onChange={(v) => set({ fontFamily: v || undefined })} options={FONTS} /></Row>
        <Row label="Size">
          <CommitNumber value={labels.fontSize} min={6} max={72} step={1} onCommit={(fontSize) => set({ fontSize })} />
          <span className="muted">px</span>
        </Row>
        <Row label="Style">
          <Checkbox checked={!!labels.bold} onChange={(bold) => set({ bold })} label="Bold" />
          <Checkbox checked={!!labels.italic} onChange={(italic) => set({ italic })} label="Italic" />
        </Row>
        <Row label="Colour"><ColorField value={labels.color} onChange={(color) => set({ color })} /></Row>

        <div className="sy-sub">Halo <span className="grow" /></div>
        <Row label="Halo colour"><ColorField value={labels.haloColor} onChange={(haloColor) => set({ haloColor })} /></Row>
        <Row label="Halo width">
          <CommitNumber value={labels.haloWidth} min={0} max={8} step={0.5} onCommit={(haloWidth) => set({ haloWidth })} />
          <span className="muted">px (0 = none)</span>
        </Row>

        <div className="sy-sub">Placement <span className="grow" /></div>
        <Row label="Offset X / Y">
          <CommitNumber value={labels.offsetX ?? 0} step={1} onCommit={(offsetX) => set({ offsetX })} />
          <CommitNumber value={labels.offsetY ?? 0} step={1} onCommit={(offsetY) => set({ offsetY })} />
        </Row>
        {geom === 'LineString' && (
          <Row label="Line labels"><Checkbox checked={!!labels.followLine} onChange={(followLine) => set({ followLine })} label="Follow the line" /></Row>
        )}
        <Row label="Overlap"><Checkbox checked={!!labels.allowOverlap} onChange={(allowOverlap) => set({ allowOverlap })} label="Allow labels to overlap" /></Row>

        <div className="sy-sub">Visible zoom range <span className="grow" /></div>
        <Row label="Min zoom">
          <CommitNumber value={labels.minZoom ?? 0} min={0} max={24} step={0.5} onCommit={(minZoom) => set({ minZoom: minZoom <= 0 ? undefined : minZoom })} />
          <IconButton icon={Crosshair} title="Use the current zoom" onClick={() => set({ minZoom: currentZoom() })} />
          <IconButton icon={X} title="Clear" disabled={labels.minZoom === undefined} onClick={() => set({ minZoom: undefined })} />
        </Row>
        <Row label="Max zoom">
          <CommitNumber value={labels.maxZoom ?? 24} min={0} max={24} step={0.5} onCommit={(maxZoom) => set({ maxZoom: maxZoom >= 24 ? undefined : maxZoom })} />
          <IconButton icon={Crosshair} title="Use the current zoom" onClick={() => set({ maxZoom: currentZoom() })} />
          <IconButton icon={X} title="Clear" disabled={labels.maxZoom === undefined} onClick={() => set({ maxZoom: undefined })} />
        </Row>
        <div className="sy-note">Labels appear between the min and max zoom (0 and 24 = unlimited).</div>
      </div>
    </>
  );
}
