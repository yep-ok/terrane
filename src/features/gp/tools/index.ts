import type { ToolDef } from '../types';
import { OVERLAY_TOOLS } from './overlay';
import { PROXIMITY_TOOLS } from './proximity';
import { FEATURE_TOOLS } from './features';
import { GENERALIZE_TOOLS } from './generalize';
import { STATS_TOOLS } from './stats';
import { SURFACE_TOOLS } from './surfaces';
import { GENERATE_TOOLS } from './generate';

export const ALL_TOOLS: ToolDef[] = [
  ...PROXIMITY_TOOLS, ...OVERLAY_TOOLS, ...FEATURE_TOOLS, ...GENERALIZE_TOOLS, ...STATS_TOOLS, ...SURFACE_TOOLS, ...GENERATE_TOOLS,
];

const byId = new Map(ALL_TOOLS.map((t) => [t.id, t]));
export const getTool = (id: string): ToolDef | undefined => byId.get(id);
