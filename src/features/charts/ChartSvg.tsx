// The chart as one self-contained SVG (title, axes, marks and legend), so it can be exported as-is.
import type { Ref } from 'react';
import type { ChartConfig } from './config';
import type { ChartModel } from './model';
import { BarChart, BoxPlot } from './renderBar';
import { Histogram } from './renderHist';
import { PieChart } from './renderPie';
import { LineChart, ScatterPlot } from './renderScatter';
import type { ChartActions } from './svgParts';

export function ChartSvg({
  model, cfg, width, height, actions, hasSelection, svgRef,
}: {
  model: Exclude<ChartModel, { kind: 'invalid' }>;
  cfg: ChartConfig;
  width: number;
  height: number;
  actions: ChartActions;
  hasSelection: boolean;
  svgRef: Ref<SVGSVGElement>;
}) {
  const common = { cfg, width, height, actions, hasSelection };
  let body;
  switch (model.kind) {
    case 'bar': body = <BarChart model={model} {...common} />; break;
    case 'pie': body = <PieChart model={model} {...common} />; break;
    case 'histogram': body = <Histogram model={model} {...common} />; break;
    case 'scatter': body = <ScatterPlot model={model} {...common} />; break;
    case 'line': body = <LineChart model={model} {...common} />; break;
    case 'box': body = <BoxPlot model={model} {...common} />; break;
  }
  return (
    <svg
      ref={svgRef}
      className="tc-svg"
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={model.title}
    >
      <rect className="tc-bg" x={0} y={0} width={width} height={height} onClick={(e) => { if (!(e.ctrlKey || e.shiftKey || e.metaKey)) actions.clear(); }} />
      {body}
    </svg>
  );
}
