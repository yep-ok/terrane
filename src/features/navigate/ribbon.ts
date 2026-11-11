// Ribbon layout for the navigate module.
import { Bookmark, Ruler } from 'lucide-react';
import { getMap } from '../../core/store';
import { useUi } from '../../core/ui';
import { registerRibbonGroup, type RibbonMenuEntry } from '../../core/registry';

function bookmarkEntries(): RibbonMenuEntry[] {
  const marks = getMap(useUi.getState().activeMapId)?.bookmarks ?? [];
  const entries: RibbonMenuEntry[] = marks.map((b) => ({ command: 'map.bookmark.go', label: b.name, arg: b.id }));
  if (entries.length) entries.push('separator');
  entries.push('map.bookmark.new', 'map.bookmarks');
  return entries;
}

export function registerNavigateRibbon() {
  registerRibbonGroup({
    tab: 'map', id: 'navigate', title: 'Navigate', order: 10,
    items: [
      { type: 'button', command: 'tool.explore', size: 'large' },
      { type: 'button', command: 'map.zoomFull', size: 'large' },
      {
        type: 'stack',
        items: [
          { type: 'button', command: 'map.zoomIn', size: 'small' },
          { type: 'button', command: 'map.zoomOut', size: 'small' },
          { type: 'button', command: 'select.zoomTo', size: 'small' },
        ],
      },
      {
        type: 'stack',
        items: [
          { type: 'button', command: 'map.prevExtent', size: 'small' },
          { type: 'button', command: 'map.nextExtent', size: 'small' },
          { type: 'button', command: 'map.rotateReset', size: 'small' },
        ],
      },
      { type: 'menu', label: 'Bookmarks', icon: Bookmark, size: 'large', items: bookmarkEntries },
      { type: 'button', command: 'map.goToXY', size: 'large' },
    ],
  });
  registerRibbonGroup({
    tab: 'map', id: 'basemap', title: 'Basemap', order: 25,
    items: [
      { type: 'button', command: 'map.basemap', size: 'large' },
      { type: 'button', command: 'map.crs', size: 'large', label: 'Coordinate System' },
    ],
  });
  registerRibbonGroup({
    tab: 'map', id: 'selection', title: 'Selection', order: 30,
    items: [
      { type: 'split', command: 'tool.select-rect', size: 'large', label: 'Select', items: ['tool.select-rect', 'tool.select-polygon', 'tool.select-lasso'] },
      { type: 'button', command: 'select.byAttributes', size: 'large' },
      { type: 'button', command: 'select.byLocation', size: 'large' },
      {
        type: 'stack',
        items: [
          { type: 'button', command: 'select.clear', size: 'small' },
          { type: 'button', command: 'select.zoomTo', size: 'small' },
        ],
      },
    ],
  });
  registerRibbonGroup({
    tab: 'map', id: 'inquiry', title: 'Inquiry', order: 40,
    items: [
      { type: 'menu', label: 'Measure', icon: Ruler, size: 'large', items: ['tool.measure-distance', 'tool.measure-area', 'separator', 'measure.clear'] },
      { type: 'button', command: 'map.locate', size: 'large' },
      {
        type: 'stack',
        items: [
          { type: 'button', command: 'measure.clear', size: 'small' },
          { type: 'button', command: 'map.clearMarkers', size: 'small' },
        ],
      },
    ],
  });
  registerRibbonGroup({
    tab: 'layer', id: 'selection', title: 'Selection', order: 40,
    items: [
      {
        type: 'stack',
        items: [
          { type: 'button', command: 'select.all', size: 'small' },
          { type: 'button', command: 'select.invert', size: 'small' },
          { type: 'button', command: 'select.clear', size: 'small' },
        ],
      },
      { type: 'button', command: 'select.zoomTo', size: 'large' },
    ],
  });
}
