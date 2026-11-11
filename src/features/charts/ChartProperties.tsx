// Right-dock pane 'chart-properties': configuration of the chart in the active chart view.
import { ChartColumn } from 'lucide-react';
import { useDataset } from '../../core/data';
import { findFeatureLayer, updateChart, useLayer, useProject } from '../../core/store';
import { runCommand } from '../../core/registry';
import type { Dataset } from '../../core/types';
import { Button, Checkbox, Empty, FieldSelect, LayerSelect, NUMERIC, NumberInput, Row, Section, Select, Slider, TextInput, ColorInput, cx } from '../../ui/kit';
import { RAMPS, getRamp } from '../symbology/ramps';
import {
  AGG_LABELS, CHART_TYPES, autoTitle, makeConfig, pickFields, readConfig,
  type ChartConfig, type ChartType, type ColorMode, type SortMode,
} from './config';
import { TYPE_ICONS } from './icons';
import { symbologyField } from './model';
import { suggestBinCount, type Agg } from './stats';
import { useActiveChartId } from './state';

const AGGS = (Object.keys(AGG_LABELS) as Agg[]).map((value) => ({ value, label: AGG_LABELS[value] }));
const SORTS: Array<{ value: SortMode; label: string }> = [
  { value: 'value-desc', label: 'Value, high to low' },
  { value: 'value-asc', label: 'Value, low to high' },
  { value: 'label', label: 'Label (A to Z)' },
  { value: 'none', label: 'Data order' },
];

function RampPreview({ name }: { name: string }) {
  const r = getRamp(name);
  const bg = r.kind === 'qualitative' ? `linear-gradient(to right, ${r.colors.map((c, i) => `${c} ${(i / r.colors.length) * 100}% ${((i + 1) / r.colors.length) * 100}%`).join(',')})` : `linear-gradient(to right, ${r.colors.join(',')})`;
  return <span className="chart-ramp" style={{ background: bg }} />;
}

export function ChartPropertiesPane() {
  const chartId = useActiveChartId();
  const chart = useProject((s) => s.project.charts.find((c) => c.id === chartId));
  const layer = useLayer(chart?.layerId);
  const ds = useDataset(layer?.kind === 'feature' ? layer.datasetId : undefined);
  if (!chart) {
    return (
      <div className="pane-body">
        <Empty icon={ChartColumn} title="No chart selected">
          Open a chart view to edit its properties, or create a new chart from the active layer.
          <Button variant="primary" onClick={() => runCommand('chart.new')}>New chart</Button>
        </Empty>
      </div>
    );
  }
  return <Editor key={chart.id} chartId={chart.id} layerId={chart.layerId} mapId={chart.mapId} ds={ds} />;
}

function Editor({ chartId, layerId, mapId, ds }: { chartId: string; layerId: string; mapId: string; ds: Dataset | undefined }) {
  const chart = useProject((s) => s.project.charts.find((c) => c.id === chartId))!;
  const layer = useLayer(layerId);
  const cfg = readConfig(chart);
  const patch = (p: Partial<ChartConfig>) => updateChart(chartId, (c) => void (c.config = { ...c.config, ...p }));
  const firstNumeric = ds ? pickFields(ds).numeric[0] ?? '' : '';
  const t = cfg.type;
  const renderer = layer?.kind === 'feature' ? layer.renderer : undefined;

  const switchType = (type: ChartType) => {
    if (type !== t) updateChart(chartId, (c) => void (c.config = makeConfig(type, ds, readConfig(c))));
  };
  const changeLayer = (id: string) => {
    const hit = findFeatureLayer(id);
    if (!hit) return;
    const keep: Partial<ChartConfig> = { title: cfg.title, showTitle: cfg.showTitle, legend: cfg.legend, grid: cfg.grid, colorMode: cfg.colorMode, color: cfg.color, ramp: cfg.ramp };
    updateChart(chartId, (c) => {
      c.layerId = id;
      c.mapId = hit.map.id;
      c.config = makeConfig(cfg.type, hit.dataset, keep);
    });
  };
  const setAgg = (agg: Agg) => patch({ agg, valueField: agg === 'count' ? cfg.valueField : cfg.valueField || firstNumeric });

  // which field supplies categorical colours
  const colorKeyField = t === 'bar' ? cfg.splitField || cfg.category : t === 'pie' ? cfg.category : t === 'scatter' ? cfg.colorField : t === 'box' ? cfg.category : '';
  const canSymbology = !!colorKeyField && symbologyField(renderer, [colorKeyField]);
  const distinct = t === 'pie' || (t === 'bar' && !!cfg.splitField) || (t === 'scatter' && !!cfg.colorField) || (t === 'line' && cfg.yFields.length > 1);
  const mode: ColorMode = cfg.colorMode === 'symbology' && !canSymbology ? 'ramp' : distinct && cfg.colorMode === 'single' ? 'ramp' : cfg.colorMode;
  const usesCategories = t === 'bar' || t === 'pie' || t === 'scatter' || t === 'box';
  const showColor = (t === 'histogram' || t === 'line' || mode === 'single') && !(t === 'line' && cfg.yFields.length > 1);
  const showRamp = (mode === 'ramp' && usesCategories) || (t === 'line' && cfg.yFields.length > 1);
  const noNumeric = !!ds && !ds.fields.some((f) => NUMERIC.includes(f.type));

  const hasCategory = t === 'bar' || t === 'pie' || t === 'box';
  const hasAxes = t !== 'pie';

  return (
    <div className="pane-body">
      <Section title="Chart type">
        <div className="chart-types">
          {CHART_TYPES.map(({ type, label }) => {
            const Icon = TYPE_ICONS[type];
            return (
              <button key={type} type="button" className={cx('chart-type', type === t && 'active')} title={label} onClick={() => switchType(type)}>
                <Icon size={18} />
                <span>{label.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Data">
        <Row label="Layer">
          <LayerSelect value={layerId} mapId={mapId} onChange={changeLayer} />
        </Row>
        {noNumeric && t !== 'bar' && t !== 'pie' && <div className="chart-hint error-text" style={{ marginBottom: 7 }}>This layer has no numeric fields; only Bar and Pie charts with Count are possible.</div>}

        {(t === 'bar' || t === 'pie') && (
          <>
            <Row label="Category"><FieldSelect datasetId={ds?.id} value={cfg.category} onChange={(category) => patch({ category })} /></Row>
            {t === 'bar' && <Row label="Split by"><FieldSelect datasetId={ds?.id} value={cfg.splitField} allowNone onChange={(splitField) => patch({ splitField })} /></Row>}
            {t === 'bar' && cfg.splitField && (
              <Row label="Split style">
                <Select value={cfg.splitMode} onChange={(splitMode) => patch({ splitMode })} options={[{ value: 'grouped', label: 'Grouped' }, { value: 'stacked', label: 'Stacked (Count / Sum)' }]} />
              </Row>
            )}
            <Row label="Aggregation"><Select value={cfg.agg} onChange={setAgg} options={AGGS} /></Row>
            <Row label="Value field"><FieldSelect datasetId={ds?.id} value={cfg.valueField} types={NUMERIC} onChange={(valueField) => patch({ valueField })} /></Row>
          </>
        )}

        {t === 'histogram' && (
          <>
            <Row label="Field"><FieldSelect datasetId={ds?.id} value={cfg.field} types={[...NUMERIC, 'date']} onChange={(field) => patch({ field })} /></Row>
            <Row label="Bins">
              <NumberInput value={cfg.bins} min={2} max={200} step={1} onChange={(bins) => patch({ bins: Math.round(bins) })} />
              <Button onClick={() => patch({ bins: suggestBinCount(ds?.features.length ?? 0) })} title="Choose a bin count from the number of features">Auto</Button>
            </Row>
            <Checkbox checked={cfg.logScale} onChange={(logScale) => patch({ logScale })} label="Log10 transform (values above 0)" />
            <div className="chart-checks">
              <Checkbox checked={cfg.showMean} onChange={(showMean) => patch({ showMean })} label="Mean line" />
              <Checkbox checked={cfg.showMedian} onChange={(showMedian) => patch({ showMedian })} label="Median line" />
              <Checkbox checked={cfg.showStd} onChange={(showStd) => patch({ showStd })} label="Std. deviation band" />
            </div>
          </>
        )}

        {t === 'scatter' && (
          <>
            <Row label="X field"><FieldSelect datasetId={ds?.id} value={cfg.xField} types={[...NUMERIC, 'date']} onChange={(xField) => patch({ xField })} /></Row>
            <Row label="Y field"><FieldSelect datasetId={ds?.id} value={cfg.yField} types={[...NUMERIC, 'date']} onChange={(yField) => patch({ yField })} /></Row>
            <Row label="Colour by"><FieldSelect datasetId={ds?.id} value={cfg.colorField} allowNone onChange={(colorField) => patch({ colorField })} /></Row>
            <Row label="Size by"><FieldSelect datasetId={ds?.id} value={cfg.sizeField} types={NUMERIC} allowNone onChange={(sizeField) => patch({ sizeField })} /></Row>
            <Row label="Point size"><Slider value={cfg.pointSize} min={2} max={10} step={0.5} onChange={(pointSize) => patch({ pointSize })} format={(v) => `${v}px`} /></Row>
            <Checkbox checked={cfg.trend} onChange={(trend) => patch({ trend })} label="Linear trend line (equation and R²)" />
            <div className="chart-hint" style={{ marginTop: 6 }}>Drag a rectangle on the plot to select the points inside. Ctrl or Shift adds to the selection.</div>
          </>
        )}

        {t === 'line' && (
          <>
            <Row label="X field"><FieldSelect datasetId={ds?.id} value={cfg.xField} types={[...NUMERIC, 'date']} onChange={(xField) => patch({ xField })} /></Row>
            <Row label="Aggregation" hint="Applied when several features share the same X value.">
              <Select value={cfg.agg} onChange={(agg) => patch({ agg })} options={AGGS} />
            </Row>
            <div className="chart-label">Y series</div>
            <div className="chart-fieldlist">
              {(ds?.fields ?? []).filter((f) => NUMERIC.includes(f.type)).map((f) => (
                <Checkbox
                  key={f.name}
                  checked={cfg.yFields.includes(f.name)}
                  onChange={(on) => patch({ yFields: on ? [...cfg.yFields, f.name] : cfg.yFields.filter((n) => n !== f.name) })}
                  label={f.name}
                />
              ))}
              {!(ds?.fields ?? []).some((f) => NUMERIC.includes(f.type)) && <span className="muted">No numeric fields.</span>}
            </div>
            <div className="chart-hint" style={{ margin: '4px 0 6px' }}>With no series ticked, the chart plots the feature count per X value.</div>
            <Checkbox checked={cfg.markers} onChange={(markers) => patch({ markers })} label="Show markers" />
          </>
        )}

        {t === 'box' && (
          <>
            <Row label="Value field"><FieldSelect datasetId={ds?.id} value={cfg.field} types={[...NUMERIC, 'date']} onChange={(field) => patch({ field })} /></Row>
            <Row label="Group by"><FieldSelect datasetId={ds?.id} value={cfg.category} allowNone onChange={(category) => patch({ category })} /></Row>
          </>
        )}

        {hasCategory && (t !== 'box' || cfg.category) && (
          <>
            <Row label="Sort">
              <Select value={cfg.sort} onChange={(sort) => patch({ sort })} options={t === 'box' ? SORTS.map((s) => (s.value.startsWith('value') ? { ...s, label: s.label.replace('Value', 'Median') } : s)) : SORTS} />
            </Row>
            <Row label="Top N" hint={cfg.topN ? 'Remaining categories are combined as "Other".' : '0 shows every category.'}>
              <NumberInput value={cfg.topN} min={0} max={200} step={1} onChange={(topN) => patch({ topN: Math.round(topN) })} />
            </Row>
          </>
        )}
        {(t === 'bar' || t === 'box') && (
          <Row label="Orientation">
            <Select value={cfg.orientation} onChange={(orientation) => patch({ orientation })} options={[{ value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' }]} />
          </Row>
        )}
        {t === 'pie' && (
          <div className="chart-checks">
            <Checkbox checked={cfg.donut} onChange={(donut) => patch({ donut })} label="Donut" />
            <Checkbox checked={cfg.sliceLabels} onChange={(sliceLabels) => patch({ sliceLabels })} label="Percent labels on slices" />
          </div>
        )}

        <div style={{ marginTop: 8 }}>
          <Checkbox checked={cfg.selectionOnly} onChange={(selectionOnly) => patch({ selectionOnly })} label="Selection only" title="Chart only the features selected on the layer" />
          {layer?.kind === 'feature' && layer.definitionQuery && <div className="chart-hint" style={{ marginTop: 4 }}>Layer definition query applies: {layer.definitionQuery}</div>}
        </div>
      </Section>

      <Section title="Appearance">
        <Row label="Title">
          <Checkbox checked={cfg.showTitle} onChange={(showTitle) => patch({ showTitle })} />
          <TextInput value={cfg.title} placeholder={autoTitle(cfg)} disabled={!cfg.showTitle} onChange={(title) => patch({ title })} />
        </Row>
        {hasAxes && (
          <>
            <Row label="Horizontal axis"><TextInput value={cfg.xTitle} placeholder="Automatic" onChange={(xTitle) => patch({ xTitle })} /></Row>
            <Row label="Vertical axis"><TextInput value={cfg.yTitle} placeholder="Automatic" onChange={(yTitle) => patch({ yTitle })} /></Row>
          </>
        )}
        <div className="chart-checks">
          {t !== 'histogram' && t !== 'box' && <Checkbox checked={cfg.legend} onChange={(legend) => patch({ legend })} label="Legend" />}
          {t === 'histogram' && <Checkbox checked={cfg.legend} onChange={(legend) => patch({ legend })} label="Statistics panel" />}
          {hasAxes && <Checkbox checked={cfg.grid} onChange={(grid) => patch({ grid })} label="Gridlines" />}
        </div>
      </Section>

      <Section title="Colours">
        {usesCategories && (
          <Row label="Colour mode">
            <Select
              value={mode}
              onChange={(colorMode) => patch({ colorMode })}
              options={[
                ...(distinct ? [] : [{ value: 'single' as ColorMode, label: 'Single colour' }]),
                { value: 'ramp' as ColorMode, label: t === 'bar' && !cfg.splitField ? 'One colour per category' : 'Colour ramp' },
                { value: 'symbology' as ColorMode, label: 'Match layer symbology', disabled: !canSymbology },
              ]}
            />
          </Row>
        )}
        {usesCategories && !canSymbology && colorKeyField && <div className="chart-hint" style={{ marginBottom: 7 }}>Matching symbology needs a unique-values renderer on "{colorKeyField}".</div>}
        {showColor && <Row label="Colour"><ColorInput value={cfg.color} onChange={(color) => patch({ color })} /></Row>}
        {showRamp && (
          <Row label="Ramp">
            <Select value={cfg.ramp} onChange={(ramp) => patch({ ramp })} options={RAMPS.map((r) => r.name)} />
            <RampPreview name={cfg.ramp} />
          </Row>
        )}
        {t === 'line' && cfg.yFields.length <= 1 && <div className="chart-hint">Pick several Y series to colour them from a ramp.</div>}
      </Section>
    </div>
  );
}
