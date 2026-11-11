import { ChartCandlestick, ChartColumn, ChartLine, ChartNoAxesColumn, ChartPie, ChartScatter, type LucideIcon } from 'lucide-react';
import type { ChartType } from './config';

export const TYPE_ICONS: Record<ChartType, LucideIcon> = {
  bar: ChartColumn,
  histogram: ChartNoAxesColumn,
  scatter: ChartScatter,
  line: ChartLine,
  pie: ChartPie,
  box: ChartCandlestick,
};
