// Layout element property schemas. LayoutElement.props is typed loosely by core; this file
// is the authoritative description of what each element type stores. All lengths are page
// millimetres unless noted; font sizes are typographic points (1 pt = 0.3528 mm).
import type { Id, LayoutDoc, LayoutElement, LayoutElementType, ViewState } from '../../core/types';

/** Props every element may carry (kept in props because LayoutElement has no fields for them). */
export interface CommonProps {
  /** Hidden elements are not drawn on screen or in exports. */
  hidden?: boolean;
  /** Locked elements cannot be selected on the page, moved or resized (still editable in the pane). */
  locked?: boolean;
}

export interface MapFrameProps extends CommonProps {
  mapId: Id;
  /** View of the frame. Zoom is relative to a 96 dpi rendering of the frame, so getScale() is the printed scale. */
  view: ViewState;
  /** Border colour and width (mm); width 0 = no border. */
  borderColor: string;
  borderWidth: number;
  /** Background behind the map; '' = transparent. */
  background: string;
}

export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';

export interface TextProps extends CommonProps {
  /** May contain tokens: {project} {layout} {map} {date} {time} {scale} {crs} {author}. */
  text: string;
  fontSize: number; // pt
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  color: string;
  align: HAlign;
  vAlign: VAlign;
  /** '' = transparent. */
  background: string;
  padding: number; // mm
  /** Line height as a multiple of the font size. */
  lineHeight: number;
}

export interface LegendProps extends CommonProps {
  /** Id of the linked map frame element ('' = first map frame on the page). */
  frameId: Id;
  title: string;
  /** Layer ids to include, or null for every visible feature layer of the linked map. */
  layerIds: Id[] | null;
  columns: number;
  fontSize: number; // pt, item labels (title is 1.3x, headings 1.0x bold)
  fontFamily: string;
  color: string;
  showLayerNames: boolean;
  borderColor: string;
  borderWidth: number; // mm, 0 = none
  background: string; // '' = none
  padding: number; // mm
}

export type ScaleBarStyle = 'bar' | 'line' | 'text';
export type ScaleUnits = 'metric' | 'imperial';

export interface ScaleBarProps extends CommonProps {
  frameId: Id;
  style: ScaleBarStyle;
  units: ScaleUnits;
  /** Number of segments (bar / line styles). */
  divisions: number;
  fontSize: number; // pt
  fontFamily: string;
  color: string;
  background: string; // '' = none
}

export type NorthArrowDesign = 'classic' | 'compass' | 'simple' | 'star';

export interface NorthArrowProps extends CommonProps {
  frameId: Id;
  design: NorthArrowDesign;
  color: string;
  background: string;
}

export interface RectProps extends CommonProps {
  fill: string; // '' = none
  stroke: string; // '' = none
  strokeWidth: number; // mm
  radius: number; // mm
}

export interface ImageProps extends CommonProps {
  /** data: URL of the image. '' = not chosen yet. */
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  /** contain = preserve aspect inside the box; stretch = fill the box. */
  fit: 'contain' | 'stretch';
}

export type ElementProps = {
  map: MapFrameProps;
  text: TextProps;
  legend: LegendProps;
  scalebar: ScaleBarProps;
  northarrow: NorthArrowProps;
  rect: RectProps;
  image: ImageProps;
  chart: CommonProps;
};

export type TypedElement<T extends LayoutElementType> = Omit<LayoutElement, 'type' | 'props'> & { type: T; props: ElementProps[T] };

export function propsOf<T extends LayoutElementType>(el: LayoutElement, _type?: T): ElementProps[T] {
  return el.props as ElementProps[T];
}

/** Extra per-layout settings stored on the LayoutDoc (not in the core type). */
export interface LayoutMeta {
  author?: string;
  /** Margin guide inset (mm). */
  margin?: number;
}
export const metaOf = (l: LayoutDoc): LayoutMeta => l as unknown as LayoutMeta;

export interface PagePreset {
  id: string;
  label: string;
  width: number; // portrait mm
  height: number;
}
export const PAGE_PRESETS: PagePreset[] = [
  { id: 'A5', label: 'A5 (148 × 210 mm)', width: 148, height: 210 },
  { id: 'A4', label: 'A4 (210 × 297 mm)', width: 210, height: 297 },
  { id: 'A3', label: 'A3 (297 × 420 mm)', width: 297, height: 420 },
  { id: 'A2', label: 'A2 (420 × 594 mm)', width: 420, height: 594 },
  { id: 'Letter', label: 'Letter (8.5 × 11 in)', width: 215.9, height: 279.4 },
  { id: 'Legal', label: 'Legal (8.5 × 14 in)', width: 215.9, height: 355.6 },
  { id: 'Tabloid', label: 'Tabloid (11 × 17 in)', width: 279.4, height: 431.8 },
];

export const FONT_FAMILIES = [
  { value: 'Segoe UI, Helvetica, Arial, sans-serif', label: 'Sans serif' },
  { value: 'Georgia, Times New Roman, serif', label: 'Serif' },
  { value: 'Consolas, Courier New, monospace', label: 'Monospace' },
  { value: 'Arial Narrow, Arial, sans-serif', label: 'Narrow' },
];
export const DEFAULT_FONT = FONT_FAMILIES[0].value;
