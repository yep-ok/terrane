import { describe, expect, it } from 'vitest';
import shp from 'shpjs';
import type { Field } from '../../core/types';
import { createDataset, getBlob, putBlob, splitByGeomType, allDatasets } from '../../core/data';
import { addMap, getProject, newProject, renameProject } from '../../core/store';
import { flattenProps, legacyCrsCode, normalizeGeoJSON, parseGeoJSON } from './parse/geojson';
import { detectCsvColumns, parseDelimited, tableToFeatures } from './parse/csv';
import { parseWkt, toWkt, tryParseWkt } from './parse/wkt';
import { parseXml } from './parse/xml';
import { parseKml } from './parse/kml';
import { parseGpx } from './parse/gpx';
import { parseTopology } from './parse/topo';
import { parseBuffer } from './parse';
import { tiffLonLatExtent } from './parse/tiff';
import { toCsv, toGeoJSON, toGpx, toKml, shapefileFieldNames, type ExportSource } from './export/formats';
import { buildShapefileZip } from './export/shapefile';
import { loadTerraneFile, projectToBlob } from './persist';
import { CITY_COUNT, cityFeatures, continentOf, graticuleFeatures } from './samples/data';
import { parseWmsCapabilities, parseWfsFeatureTypes, withParams, stripOgcParams } from './services';

const pt = (lon: number, lat: number, props: Record<string, any> = {}) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [lon, lat] }, properties: props });

describe('GeoJSON normalisation', () => {
  it('accepts collections, features, bare geometries and arrays', () => {
    const f = pt(1, 2, { a: 1 });
    expect(normalizeGeoJSON({ type: 'FeatureCollection', features: [f] })).toHaveLength(1);
    expect(normalizeGeoJSON(f)).toHaveLength(1);
    expect(normalizeGeoJSON(f.geometry)[0].properties).toEqual({});
    expect(normalizeGeoJSON([f, f.geometry, { nope: true }])).toHaveLength(2);
    expect(normalizeGeoJSON('x')).toEqual([]);
  });

  it('stringifies nested properties and keeps feature ids', () => {
    expect(flattenProps({ a: { b: 1 }, c: [1, 2], d: 'x' })).toEqual({ a: '{"b":1}', c: '[1,2]', d: 'x' });
    const [f] = normalizeGeoJSON({ type: 'Feature', id: 'abc', geometry: null, properties: { name: 'n' } });
    expect(f.properties).toEqual({ name: 'n', id: 'abc' });
    expect(f.geometry).toBeNull();
  });

  it('reads the legacy crs member', () => {
    expect(legacyCrsCode({ crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3857' } } })).toBe('EPSG:3857');
    expect(legacyCrsCode({ crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } } })).toBeNull();
    expect(legacyCrsCode({})).toBeNull();
  });

  it('reprojects to WGS84 when a crs is declared', async () => {
    const json = {
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'EPSG:3857' } },
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1113194.9079327357, 6446275.841017161] } }],
    };
    const [layer] = await parseGeoJSON(json, 'x');
    const c = (layer.features[0].geometry as any).coordinates;
    expect(c[0]).toBeCloseTo(10, 4);
    expect(c[1]).toBeCloseTo(50, 4);
  });

  it('splits mixed geometry by family', () => {
    const groups = splitByGeomType([pt(0, 0), { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }, { type: 'Feature', properties: {}, geometry: null }] as any);
    expect(Object.keys(groups).sort()).toEqual(['LineString', 'Point', 'Table']);
  });

  it('parses TopoJSON objects', () => {
    const topo = {
      type: 'Topology',
      arcs: [[[0, 0], [10, 0], [0, 10], [-10, 0], [0, -10]]],
      objects: { shapes: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', arcs: [[0]], properties: { name: 'sq' }, id: 7 }] } },
    };
    const [layer] = parseTopology(topo, 'file');
    expect(layer.features).toHaveLength(1);
    expect(layer.features[0].geometry?.type).toBe('Polygon');
    expect(layer.features[0].properties).toMatchObject({ name: 'sq' });
  });
});

describe('WKT', () => {
  it('round-trips every geometry type', () => {
    const samples = [
      'POINT (1 2)',
      'LINESTRING (0 0, 1 1, 2 0)',
      'POLYGON ((0 0, 4 0, 4 4, 0 4, 0 0), (1 1, 2 1, 2 2, 1 1))',
      'MULTIPOINT ((1 2), (3 4))',
      'MULTILINESTRING ((0 0, 1 1), (2 2, 3 3))',
      'MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5)))',
    ];
    for (const s of samples) expect(toWkt(parseWkt(s))).toBe(s);
  });

  it('handles Z values, SRID prefixes, EMPTY and bad input', () => {
    expect(parseWkt('POINT Z (1 2 3)')).toEqual({ type: 'Point', coordinates: [1, 2] });
    expect(parseWkt('SRID=4326;POINT(5 6)')).toEqual({ type: 'Point', coordinates: [5, 6] });
    expect(parseWkt('POINT EMPTY')).toBeNull();
    expect(tryParseWkt('hello world')).toBeNull();
    expect(tryParseWkt('POINT (a b)')).toBeNull();
    expect(parseWkt('MULTIPOINT (1 2, 3 4)')).toEqual({ type: 'MultiPoint', coordinates: [[1, 2], [3, 4]] });
  });
});

describe('delimited text', () => {
  it('detects delimiter, types columns and keeps leading zeros', () => {
    const t = parseDelimited('id;name;pop;ok\n001;Alpha;12;true\n002;Beta;3.5;false\n');
    expect(t.delimiter).toBe(';');
    expect(t.rows[0]).toEqual(['001', 'Alpha', 12, true]);
    expect(t.rows[1][2]).toBe(3.5);
  });

  it('dedupes headers and strips a BOM', () => {
    const t = parseDelimited('﻿a,a,\n1,2,3\n');
    expect(t.headers).toEqual(['a', 'a_1', 'field3']);
  });

  it('finds lat/lon columns case-insensitively', () => {
    const d = detectCsvColumns(parseDelimited('Name,Latitude,Longitude\nA,10,20\nB,11,21\n'));
    expect(d).toMatchObject({ x: 'Longitude', y: 'Latitude', wkt: null, crs: 'EPSG:4326' });
  });

  it('suggests a projected CRS when values exceed degrees', () => {
    const d = detectCsvColumns(parseDelimited('x,y\n500000,4000000\n500100,4000100\n'));
    expect(d.x).toBe('x');
    expect(d.crs).toBe('EPSG:3857');
  });

  it('finds a WKT column by name or by content', () => {
    expect(detectCsvColumns(parseDelimited('id,wkt\n1,POINT (1 2)\n')).wkt).toBe('wkt');
    expect(detectCsvColumns(parseDelimited('id,shape_text\n1,POINT (1 2)\n2,POINT (3 4)\n')).wkt).toBe('shape_text');
  });

  it('builds point features and counts unlocated rows', () => {
    const t = parseDelimited('n,lon,lat\na,10,20\nb,,\nc,200,5\n');
    const { features, located } = tableToFeatures(t, { x: 'lon', y: 'lat' });
    expect(located).toBe(1);
    expect(features).toHaveLength(3);
    expect(features[1].geometry).toBeNull();
  });

  it('reprojects x/y from a projected CRS', () => {
    const t = parseDelimited('x,y\n1113194.9079327357,6446275.841017161\n');
    const { features } = tableToFeatures(t, { x: 'x', y: 'y', crs: 'EPSG:3857' });
    expect((features[0].geometry as any).coordinates[0]).toBeCloseTo(10, 4);
  });

  it('builds geometry from WKT', () => {
    const t = parseDelimited('id,wkt\n1,"POLYGON ((0 0, 1 0, 1 1, 0 0))"\n');
    const { features, located } = tableToFeatures(t, { wkt: 'wkt' });
    expect(located).toBe(1);
    expect(features[0].geometry?.type).toBe('Polygon');
  });
});

describe('XML, KML and GPX', () => {
  it('parses attributes, entities, CDATA and self-closing tags', () => {
    const root = parseXml('<?xml version="1.0"?><a x="1 &amp; 2"><!-- c --><b/><c><![CDATA[<raw>]]></c><d>&lt;t&gt; &#65;</d></a>');
    expect(root.attrs.x).toBe('1 & 2');
    expect(root.children.map((c) => c.name)).toEqual(['b', 'c', 'd']);
    expect(root.children[1].text).toBe('<raw>');
    expect(root.children[2].text).toBe('<t> A');
  });

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Doc</name>
<Folder><Placemark><name>A &amp; B</name><description><![CDATA[<b>hi</b>]]></description>
<ExtendedData><Data name="pop"><value>12</value></Data></ExtendedData><Point><coordinates>10,20,5</coordinates></Point></Placemark>
<Placemark><name>Line</name><LineString><coordinates>0,0 1,1 2,0</coordinates></LineString></Placemark>
<Placemark><name>Poly</name><Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 4,0 4,4 0,4 0,0</coordinates></LinearRing></outerBoundaryIs>
<innerBoundaryIs><LinearRing><coordinates>1,1 2,1 2,2 1,1</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark>
<Placemark><name>Multi</name><MultiGeometry><Point><coordinates>1,1</coordinates></Point><Point><coordinates>2,2</coordinates></Point></MultiGeometry></Placemark>
</Folder></Document></kml>`;

  it('reads placemarks of every geometry kind', () => {
    const [layer] = parseKml(kml, 'places');
    expect(layer.name).toBe('places');
    expect(layer.features).toHaveLength(4);
    expect(layer.features[0].properties).toMatchObject({ name: 'A & B', pop: 12, description: '<b>hi</b>' });
    expect(layer.features[0].geometry).toEqual({ type: 'Point', coordinates: [10, 20, 5] });
    expect(layer.features[1].geometry?.type).toBe('LineString');
    expect((layer.features[2].geometry as any).coordinates).toHaveLength(2);
    expect(layer.features[3].geometry?.type).toBe('MultiPoint');
  });

  it('rejects non-KML content', () => {
    expect(() => parseKml('<html></html>', 'x')).toThrow();
  });

  it('reads GPX waypoints, routes and tracks', () => {
    const gpx = `<gpx version="1.1"><wpt lat="1" lon="2"><ele>10</ele><name>W</name></wpt>
      <rte><name>R</name><rtept lat="0" lon="0"/><rtept lat="1" lon="1"/></rte>
      <trk><name>T</name><trkseg><trkpt lat="0" lon="0"/><trkpt lat="1" lon="1"/></trkseg><trkseg><trkpt lat="5" lon="5"/><trkpt lat="6" lon="6"/></trkseg></trk></gpx>`;
    const layers = parseGpx(gpx, 'hike');
    expect(layers.map((l) => l.name)).toEqual(['hike (waypoints)', 'hike (routes)', 'hike (tracks)']);
    expect(layers[0].features[0].properties).toMatchObject({ name: 'W', ele: 10 });
    expect(layers[2].features[0].geometry?.type).toBe('MultiLineString');
  });

  it('dispatches by extension through parseBuffer', async () => {
    const buf = new TextEncoder().encode(kml).buffer as ArrayBuffer;
    const out = await parseBuffer('places.kml', buf);
    expect(out[0].kind).toBe('layers');
    const csv = await parseBuffer('a.csv', new TextEncoder().encode('lat,lon\n1,2\n').buffer as ArrayBuffer);
    expect(csv[0]).toMatchObject({ kind: 'csv', detection: { x: 'lon', y: 'lat' } });
    await expect(parseBuffer('x.geojson', new TextEncoder().encode('{nope').buffer as ArrayBuffer)).rejects.toThrow(/JSON/);
  });
});

const fields: Field[] = [
  { name: 'NAME', type: 'string' },
  { name: 'POP', type: 'integer' },
  { name: 'a very long field name', type: 'number' },
  { name: 'a very long field name 2', type: 'number' },
];
const source = (features: ExportSource['features'], geomType: ExportSource['geomType'] = 'Point'): ExportSource => ({ name: 'Cities', geomType, fields, features });
const pts = source([
  { geometry: { type: 'Point', coordinates: [10, 20] }, properties: { NAME: 'A, "quoted"', POP: 5, 'a very long field name': 1.5, 'a very long field name 2': null } },
  { geometry: null, properties: { NAME: 'B', POP: null } },
]);

describe('exporters', () => {
  it('GeoJSON round-trips through the importer', async () => {
    const [layer] = await parseGeoJSON(JSON.parse(toGeoJSON(pts)), 'x');
    expect(layer.features).toHaveLength(2);
    expect(layer.features[0].properties?.NAME).toBe('A, "quoted"');
  });

  it('CSV quotes values and writes X/Y, WKT or nothing', () => {
    const xy = toCsv(pts, { geometry: 'xy' }).split('\r\n');
    expect(xy[0]).toBe('NAME,POP,a very long field name,a very long field name 2,X,Y');
    expect(xy[1]).toBe('"A, ""quoted""",5,1.5,,10,20');
    expect(xy[2]).toBe('B,,,,,');
    expect(toCsv(pts, { geometry: 'wkt' }).split('\r\n')[1]).toContain('POINT (10 20)');
    expect(toCsv(pts, { geometry: 'none' }).split('\r\n')[0]).toBe('NAME,POP,a very long field name,a very long field name 2');
  });

  it('CSV avoids colliding with existing X/Y fields', () => {
    const s: ExportSource = { name: 'n', geomType: 'Point', fields: [{ name: 'X', type: 'number' }], features: [{ geometry: { type: 'Point', coordinates: [1, 2] }, properties: { X: 9 } }] };
    expect(toCsv(s, { geometry: 'xy' }).split('\r\n')[0]).toBe('X,X_,Y');
  });

  it('CSV re-imports with detected columns', () => {
    const t = parseDelimited(toCsv(pts, { geometry: 'xy' }));
    const d = detectCsvColumns(t);
    expect(d.x).toBe('X');
    expect(tableToFeatures(t, { x: d.x, y: d.y }).located).toBe(1);
  });

  it('KML escapes text and survives a round trip', () => {
    const kml = toKml(pts);
    expect(kml).toContain('<name>A, &quot;quoted&quot;</name>');
    expect(kml).toContain('<coordinates>10,20</coordinates>');
    const [layer] = parseKml(kml, 'rt');
    expect(layer.features).toHaveLength(2);
    expect(layer.features[0].properties).toMatchObject({ name: 'A, "quoted"', POP: 5 });
  });

  it('KML writes polygons with holes and multi geometries', () => {
    const s = source(
      [{ geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [4, 0], [4, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 1]]]] }, properties: {} }],
      'Polygon',
    );
    const kml = toKml(s);
    expect(kml).toContain('<MultiGeometry>');
    expect(kml).toContain('innerBoundaryIs');
    const [layer] = parseKml(kml, 'p');
    expect(layer.features[0].geometry?.type).toBe('MultiPolygon');
  });

  it('GPX exports points and lines but refuses polygons', () => {
    expect(toGpx(pts)).toContain('<wpt lat="20" lon="10">');
    const lines = source([{ geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { NAME: 'L' } }], 'LineString');
    const gpx = toGpx(lines);
    expect(gpx).toContain('<trk><name>L</name>');
    expect(parseGpx(gpx, 'x')[0].features[0].geometry?.type).toBe('LineString');
    expect(() => toGpx(source([], 'Polygon'))).toThrow(/polygons/);
  });

  it('shapefile field names are DBF-safe and unique', () => {
    expect(shapefileFieldNames(['a very long field name', 'a very long field name 2', 'NAME', 'name', '1st', 'Zürich'])).toEqual([
      'a_very_lon', 'a_very_l_1', 'NAME', 'name_1', 'F1st', 'Zurich',
    ]);
  });

  it('writes a zipped shapefile that shpjs reads back (points)', async () => {
    const res = await buildShapefileZip('cities', fields, [
      { geometry: { type: 'Point', coordinates: [10.5, 20.25] }, properties: { NAME: 'Zürich', POP: 7, 'a very long field name': 1.25, 'a very long field name 2': null } },
      { geometry: { type: 'Point', coordinates: [-3, -4] }, properties: { NAME: 'B', POP: 8, 'a very long field name': -2, 'a very long field name 2': 3 } },
    ]);
    expect(res.renamed.length).toBe(2);
    const gj: any = await shp(res.zip.buffer.slice(res.zip.byteOffset, res.zip.byteOffset + res.zip.byteLength) as ArrayBuffer);
    expect(gj.features).toHaveLength(2);
    expect(gj.features[0].geometry.coordinates).toEqual([10.5, 20.25]);
    expect(gj.features[0].properties).toMatchObject({ NAME: 'Zürich', POP: 7, a_very_lon: 1.25 });
    expect(gj.features[1].properties.a_very_l_1).toBe(3);
  });

  it('writes polygons (mixed Polygon/MultiPolygon, hole) and lines', async () => {
    const f: Field[] = [{ name: 'ID', type: 'integer' }];
    const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const hole = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]];
    const polys = await buildShapefileZip('p', f, [
      { geometry: { type: 'Polygon', coordinates: [square, hole] }, properties: { ID: 1 } },
      { geometry: { type: 'MultiPolygon', coordinates: [[[[20, 20], [30, 20], [30, 30], [20, 20]]], [[[40, 40], [50, 40], [50, 50], [40, 40]]]] }, properties: { ID: 2 } },
      { geometry: null, properties: { ID: 3 } },
    ]);
    const gj: any = await shp(polys.zip.buffer.slice(polys.zip.byteOffset, polys.zip.byteOffset + polys.zip.byteLength) as ArrayBuffer);
    expect(gj.features).toHaveLength(3);
    expect(gj.features[0].geometry.type).toBe('Polygon');
    expect(gj.features[0].geometry.coordinates).toHaveLength(2); // outer + hole preserved
    expect(gj.features[1].geometry.type).toBe('MultiPolygon');
    expect(gj.features[2].geometry).toBeNull();

    const lines = await buildShapefileZip('l', f, [
      { geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { ID: 1 } },
      { geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[5, 5], [6, 6]]] }, properties: { ID: 2 } },
    ]);
    const lj: any = await shp(lines.zip.buffer.slice(lines.zip.byteOffset, lines.zip.byteOffset + lines.zip.byteLength) as ArrayBuffer);
    expect(lj.features.map((x: any) => x.geometry.type)).toEqual(['LineString', 'MultiLineString']);
  });

  it('refuses to write a shapefile without geometry', async () => {
    await expect(buildShapefileZip('t', fields, [{ geometry: null, properties: {} }])).rejects.toThrow(/geometry/);
  });
});

describe('project file round trip', () => {
  it('restores project, datasets and blobs', async () => {
    newProject('Round Trip');
    const ds = createDataset({ name: 'Pts', features: [pt(1, 2, { n: 'a' }), pt(3, 4, { n: 'b' })], source: 'test' });
    addMap({ name: 'M' });
    const blobId = putBlob(new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/tiff' }));
    renameProject('Round Trip 2');

    const text = await (await projectToBlob()).text();
    const json = JSON.parse(text);
    expect(json.format).toBe('terrane-project');
    expect(json.datasets).toHaveLength(1);
    expect(Object.keys(json.blobs)).toEqual([blobId]);

    newProject('Other');
    expect(allDatasets()).toHaveLength(0);
    loadTerraneFile(json);
    expect(getProject().name).toBe('Round Trip 2');
    expect(getProject().maps.map((m) => m.name)).toContain('M');
    const back = allDatasets();
    expect(back).toHaveLength(1);
    expect(back[0].id).toBe(ds.id);
    expect(back[0].features).toHaveLength(2);
    expect(back[0].nextFid).toBe(3);
    const blob = getBlob(blobId)!;
    expect(blob.type).toBe('image/tiff');
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([1, 2, 3, 250]);
  });

  it('rejects foreign JSON', () => {
    expect(() => loadTerraneFile({ format: 'nope' } as any)).toThrow(/Terrane project/);
  });
});

describe('sample data', () => {
  it('has about 150 well-formed cities', () => {
    const f = cityFeatures();
    expect(CITY_COUNT).toBeGreaterThanOrEqual(140);
    for (const c of f) {
      const [lon, lat] = (c.geometry as any).coordinates;
      expect(Math.abs(lon)).toBeLessThanOrEqual(180);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      expect(c.properties!.POP_EST).toBeGreaterThan(0);
    }
    expect(new Set(f.map((c) => c.properties!.NAME)).size).toBe(f.length);
    expect(f.find((c) => c.properties!.NAME === 'Tokyo')!.properties!.CAPITAL).toBe(true);
  });

  it('maps world-atlas ids and names to continents', () => {
    expect(continentOf('840')).toBe('North America');
    expect(continentOf(76)).toBe('South America');
    expect(continentOf('004')).toBe('Asia');
    expect(continentOf(undefined, 'Kosovo')).toBe('Europe');
  });

  it('generates a graticule', () => {
    const g = graticuleFeatures(30);
    expect(g.filter((x) => x.properties!.TYPE === 'Meridian')).toHaveLength(13);
    expect(g.filter((x) => x.properties!.TYPE === 'Parallel')).toHaveLength(5);
  });
});

describe('web services', () => {
  it('parses WMS capabilities', () => {
    const xml = `<WMS_Capabilities version="1.3.0"><Service><Title>Svc</Title></Service><Capability>
      <Request><GetMap><Format>image/png</Format><Format>image/jpeg</Format></GetMap></Request>
      <Layer><Title>Root</Title><Layer><Name>roads</Name><Title>Roads</Title></Layer><Layer><Name>rivers</Name><Title>Rivers</Title></Layer></Layer></Capability></WMS_Capabilities>`;
    const caps = parseWmsCapabilities(xml);
    expect(caps.version).toBe('1.3.0');
    expect(caps.formats).toEqual(['image/png', 'image/jpeg']);
    expect(caps.layers.map((l) => [l.name, l.depth, l.selectable])).toEqual([['', 0, false], ['roads', 1, true], ['rivers', 1, true]]);
  });

  it('reports service exceptions and non-capabilities documents', () => {
    expect(() => parseWmsCapabilities('<ServiceExceptionReport><ServiceException>Boom</ServiceException></ServiceExceptionReport>')).toThrow('Boom');
    expect(() => parseWmsCapabilities('<html/>')).toThrow();
  });

  it('parses WFS feature types', () => {
    const xml = '<wfs:WFS_Capabilities xmlns:wfs="x"><wfs:FeatureTypeList><wfs:FeatureType><wfs:Name>ns:roads</wfs:Name><wfs:Title>Roads</wfs:Title></wfs:FeatureType></wfs:FeatureTypeList></wfs:WFS_Capabilities>';
    expect(parseWfsFeatureTypes(xml)).toEqual([{ name: 'ns:roads', title: 'Roads', depth: 0, selectable: true }]);
  });

  it('manipulates OGC query parameters', () => {
    expect(withParams('https://h/wms?SERVICE=wms&x=1', { service: 'WMS', request: 'GetCapabilities' })).toBe('https://h/wms?x=1&service=WMS&request=GetCapabilities');
    expect(stripOgcParams('https://h/wms?SERVICE=WMS&REQUEST=GetMap&map=a.map')).toBe('https://h/wms?map=a.map');
  });
});

/** Build a classic little-endian GeoTIFF header with ModelPixelScale, ModelTiepoint and a GeoKey directory. */
function geoTiff(width: number, height: number, tie: [number, number], scale: [number, number], epsg: number): Blob {
  const entries: Array<[number, number, number, number | number[]]> = [
    [256, 3, 1, width],
    [257, 3, 1, height],
    [33550, 12, 3, [scale[0], scale[1], 0]],
    [33922, 12, 6, [0, 0, 0, tie[0], tie[1], 0]],
    [34735, 3, 8, [1, 1, 0, 1, 3072, 0, 1, epsg]],
  ];
  const n = entries.length;
  const ifdSize = 2 + n * 12 + 4;
  let extra = 8 + ifdSize;
  const buf = new ArrayBuffer(8 + ifdSize + 400);
  const v = new DataView(buf);
  v.setUint16(0, 0x4949, true);
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true);
  v.setUint16(8, n, true);
  entries.forEach(([tag, type, count, value], i) => {
    const o = 10 + i * 12;
    v.setUint16(o, tag, true);
    v.setUint16(o + 2, type, true);
    v.setUint32(o + 4, count, true);
    if (Array.isArray(value)) {
      v.setUint32(o + 8, extra, true);
      value.forEach((x, k) => (type === 12 ? v.setFloat64(extra + k * 8, x, true) : v.setUint16(extra + k * 2, x, true)));
      extra += value.length * (type === 12 ? 8 : 2);
    } else v.setUint16(o + 8, value, true);
  });
  return new Blob([buf]);
}

describe('GeoTIFF header', () => {
  it('computes a lon/lat extent for a geographic raster', async () => {
    const e = await tiffLonLatExtent(geoTiff(100, 50, [10, 60], [0.1, 0.1], 4326));
    expect(e).toEqual([10, 55, 20, 60]);
  });

  it('reprojects a Web Mercator raster', async () => {
    const e = await tiffLonLatExtent(geoTiff(100, 100, [0, 1118889.97], [1113.19, 1113.19], 3857));
    expect(e![0]).toBeCloseTo(0, 3);
    expect(e![3]).toBeCloseTo(10, 1);
    expect(e![2]).toBeCloseTo(1, 1);
  });

  it('returns null for non-TIFF data', async () => {
    expect(await tiffLonLatExtent(new Blob(['not a tiff at all']))).toBeNull();
  });
});
