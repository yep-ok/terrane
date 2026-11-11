// Module-level chart state: which chart is "current" (for the properties pane and commands)
// and the live SVG element of every mounted chart view (for export).
import { create } from 'zustand';
import type { ChartDoc, Id } from '../../core/types';
import { getProject, useProject } from '../../core/store';
import { activeView, useUi } from '../../core/ui';

/** Last chart view that was in front; lets the properties pane keep working while a map is active. */
export const useChartFocus = create<{ chartId: Id | null }>(() => ({ chartId: null }));
export const focusChart = (chartId: Id) => useChartFocus.setState({ chartId });

const svgElements = new Map<Id, SVGSVGElement>();
export const registerChartSvg = (chartId: Id, el: SVGSVGElement | null) => {
  if (el) svgElements.set(chartId, el);
  else svgElements.delete(chartId);
};
export const getChartSvg = (chartId: Id) => svgElements.get(chartId);

/** Chart in the active chart view, else the last focused chart that still exists. */
export function useActiveChartId(): Id | null {
  const inView = useUi((s) => {
    const v = s.views.find((x) => x.id === s.activeViewId);
    return v?.type === 'chart' ? v.refId : null;
  });
  const last = useChartFocus((s) => s.chartId);
  const target = inView ?? last;
  const exists = useProject((s) => !!target && s.project.charts.some((c) => c.id === target));
  return exists ? target : null;
}

export function getActiveChartId(): Id | null {
  const v = activeView();
  const id = v?.type === 'chart' ? v.refId : useChartFocus.getState().chartId;
  return id && getProject().charts.some((c) => c.id === id) ? id : null;
}

export const getChart = (id: Id | null | undefined): ChartDoc | undefined => getProject().charts.find((c) => c.id === id);
