import {
  Blend, Calculator, Combine, Compass, Copy, CircleDot, Crosshair, Diff, Dices, Eraser, Filter, Flame, Grid3x3, Group, Hash, Hexagon, Layers, MapPin, Maximize, Merge, Minimize2,
  Network, Pentagon, Radar, Route, Scissors, Shapes, Share2, Sigma, Spline, Split, Table, Target, Waves, Waypoints, Dot, Wrench, type LucideIcon,
} from 'lucide-react';

const TOOL_ICONS: Record<string, LucideIcon> = {
  buffer: CircleDot,
  'multiple-ring-buffer': Target,
  near: Crosshair,
  'create-thiessen-polygons': Network,
  clip: Scissors,
  intersect: Blend,
  union: Combine,
  erase: Eraser,
  'symmetrical-difference': Diff,
  dissolve: Group,
  merge: Merge,
  'spatial-join': Share2,
  'summarize-within': Sigma,
  'count-overlapping': Layers,
  'tabulate-intersection': Table,
  select: Filter,
  'feature-to-point': MapPin,
  'feature-vertices-to-points': Dot,
  'polygon-to-line': Pentagon,
  'feature-to-polygon': Pentagon,
  'points-to-line': Route,
  'minimum-bounding-geometry': Maximize,
  'multipart-to-singlepart': Split,
  'delete-identical': Copy,
  'calculate-geometry-attributes': Calculator,
  simplify: Minimize2,
  smooth: Spline,
  densify: Waypoints,
  'summary-statistics': Sigma,
  frequency: Hash,
  'kernel-density': Flame,
  'idw-interpolation': Waves,
  'aggregate-points': Hexagon,
  'generate-tessellation': Grid3x3,
  'create-random-points': Dices,
  'xy-to-line': Route,
  'bearing-distance-to-line': Compass,
};

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Overlay: Layers,
  Proximity: Radar,
  Features: Shapes,
  Generalization: Spline,
  Statistics: Sigma,
  'Density & Surfaces': Flame,
  Generate: Grid3x3,
};

export const toolIcon = (id: string): LucideIcon => TOOL_ICONS[id] ?? Wrench;
export const categoryIcon = (cat: string): LucideIcon => CATEGORY_ICONS[cat] ?? Wrench;
