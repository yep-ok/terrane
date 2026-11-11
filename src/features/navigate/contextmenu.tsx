// Right-click context menu on the map (always-on map plugin).
import {
  Bookmark, ClipboardCopy, Crosshair, Expand, Globe, Info, ArrowLeft, Ruler, SquareDashed, SquareMousePointer, ZoomIn, ZoomOut, Eraser,
} from 'lucide-react';
import { notify, setTool, showContextMenu, useUi, type MenuItem } from '../../core/ui';
import { registerMapPlugin, runCommand } from '../../core/registry';
import type { MapHandle } from '../../map/handle';
import { formatDD } from './coords';
import { closeIdentify, hasIdentify, identifyAt } from './explore';
import { canStep, zoomBy } from './navigation';
import { selectAtPixel } from './selection';

const ico = (I: any) => <I size={14} />;

export function registerContextMenu() {
  registerMapPlugin((handle: MapHandle) => {
    const viewport = handle.map.getViewport()!;

    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      useUi.setState({ activeMapId: handle.mapId });
      const pixel = handle.map.getEventPixel(e);
      const coord = handle.map.getCoordinateFromPixel(pixel);
      const [lon, lat] = handle.toLonLat(coord);
      const onFeature = handle.hitTest(pixel, { tolerance: 5, includeUnselectable: true }).length > 0;

      const items: MenuItem[] = [
        { label: 'Zoom In Here', icon: ico(ZoomIn), onClick: () => zoomBy(handle, 1, coord) },
        { label: 'Zoom Out Here', icon: ico(ZoomOut), onClick: () => zoomBy(handle, -1, coord) },
        { label: 'Zoom To Full Extent', icon: ico(Expand), onClick: () => runCommand('map.zoomFull') },
        { label: 'Previous Extent', icon: ico(ArrowLeft), disabled: !canStep(handle.mapId, -1), onClick: () => runCommand('map.prevExtent') },
        'separator',
        { label: 'Identify Here', icon: ico(Info), disabled: !onFeature, onClick: () => identifyAt(handle, pixel, coord) },
        { label: 'Select Here', icon: ico(SquareMousePointer), disabled: !onFeature, onClick: () => selectAtPixel(handle, pixel, { shift: false, ctrl: false }) },
        'separator',
        {
          label: 'Copy Coordinates',
          icon: ico(ClipboardCopy),
          onClick: async () => {
            const text = formatDD(lon, lat);
            try {
              await navigator.clipboard.writeText(text);
              notify(`Copied ${text}`, 'success');
            } catch {
              notify('Could not access the clipboard', 'error');
            }
          },
        },
        { label: 'Add Bookmark…', icon: ico(Bookmark), onClick: () => runCommand('map.bookmark.new') },
        { label: 'Go To XY…', icon: ico(Crosshair), onClick: () => runCommand('map.goToXY', { text: formatDD(lon, lat) }) },
        {
          label: 'Measure',
          icon: ico(Ruler),
          submenu: [
            { label: 'Distance', icon: ico(Ruler), onClick: () => setTool('measure-distance') },
            { label: 'Area', icon: ico(SquareDashed), onClick: () => setTool('measure-area') },
            'separator',
            { label: 'Clear Measurements', icon: ico(Eraser), onClick: () => runCommand('measure.clear') },
          ],
        },
        'separator',
        { label: 'Map Coordinate System…', icon: ico(Globe), onClick: () => runCommand('map.crs') },
      ];
      showContextMenu(e, items);
    };

    // Esc closes an identify pop-up opened from this menu while another tool is active.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && hasIdentify(handle)) closeIdentify(handle);
    };
    viewport.addEventListener('contextmenu', onContext);
    document.addEventListener('keydown', onKey);
    return () => {
      viewport.removeEventListener('contextmenu', onContext);
      document.removeEventListener('keydown', onKey);
      closeIdentify(handle);
    };
  });
}
