// A single "you are here" marker dropped on the map by Go To XY, Locate and Add marker actions.
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { Circle, Fill, Stroke, Style, Text } from 'ol/style';
import type { MapHandle } from '../../map/handle';

const KIND = 'navMarker';

function markerStyle(label?: string) {
  return [
    new Style({ image: new Circle({ radius: 11, fill: new Fill({ color: 'rgba(229,83,75,0.22)' }), stroke: new Stroke({ color: '#e5534b', width: 1.5 }) }) }),
    new Style({
      image: new Circle({ radius: 4.5, fill: new Fill({ color: '#e5534b' }), stroke: new Stroke({ color: '#ffffff', width: 1.5 }) }),
      text: label
        ? new Text({
            text: label,
            font: '600 12px "Segoe UI", system-ui, sans-serif',
            textAlign: 'left',
            offsetX: 15,
            offsetY: -2,
            fill: new Fill({ color: '#1f2328' }),
            backgroundFill: new Fill({ color: 'rgba(255,255,255,0.92)' }),
            backgroundStroke: new Stroke({ color: '#e5534b', width: 1 }),
            padding: [2, 5, 2, 5],
          })
        : undefined,
    }),
  ];
}

export function clearMarkers(handle: MapHandle) {
  for (const f of handle.scratch.getFeatures()) if (f.get('kind') === KIND) handle.scratch.removeFeature(f);
}

/** Replace the map's marker. Label is shown beside it (truncated). */
export function placeMarker(handle: MapHandle, lon: number, lat: number, label?: string) {
  clearMarkers(handle);
  const f = new Feature(new Point(handle.toMap([lon, lat])));
  f.set('kind', KIND);
  const text = label && label.length > 48 ? label.slice(0, 47) + '…' : label;
  f.setStyle(markerStyle(text));
  handle.scratch.addFeature(f);
}

/** Marker + flash + move the view so the point is comfortably visible. */
export function goToLonLat(handle: MapHandle, lon: number, lat: number, label?: string, minZoom = 13) {
  placeMarker(handle, lon, lat, label);
  handle.flash([{ type: 'Point', coordinates: [lon, lat] }]);
  const z = handle.getViewState().zoom;
  handle.setViewState({ center: [lon, lat], zoom: Math.max(z, minZoom) });
}
