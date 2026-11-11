# Terrane architecture

Terrane is a browser GIS workstation with a ribbon / Contents / Catalog workflow.
Stack: TypeScript, React 19, Vite, zustand (+immer), OpenLayers 10, Turf 7, proj4, lucide-react icons.
It is an original product: never use Esri names, logos, icons or copied UI text.

## Layout of the code

| Path | Role |
| --- | --- |
| `src/core/types.ts` | Data model: Dataset, Field, Layer kinds, Renderer, LabelDef, MapDoc, LayoutDoc, ChartDoc, Project |
| `src/core/data.ts` | DataStore (datasets live outside React): `createDataset`, `applyEdits`, field ops, `useDataset`, `subscribeData`, extent helpers, blob store |
| `src/core/store.ts` | Project store + action functions: maps, layers, bookmarks, layouts, charts, `findLayer`, `findFeatureLayer`, `makeFeatureLayer`, `addDatasetLayer` |
| `src/core/ui.ts` | Session state: open views, active map/layer, selection, active tool, docks/panes, open tables, dialogs, toasts, context menu |
| `src/core/registry.ts` | Extension points: commands, ribbon tabs/groups, panes, dialogs, map tools, map plugins, view types |
| `src/core/history.ts` | Undo/redo (`pushUndo`, `transaction`); `applyEdits` and field ops push entries automatically |
| `src/core/expr.ts` | Expression language contract (`compileExpr`, `compileWhere`, `tryCompile`, `listFunctions`) |
| `src/core/crs.ts`, `basemaps.ts` | Coordinate systems (proj4 registered with OL), basemap list |
| `src/map/runtime.ts` | `MapRuntime`: binds an OL map to a MapDoc (layers, styles, selection, data edits). Implements `MapHandle` |
| `src/map/handle.ts` | `MapHandle` interface + `getMapHandle(mapId?)`, `featOf(olFeature)`, `layerIdOf` |
| `src/map/style.ts` | Symbology to OL styles (`makeStyleFunction`, `symbolToStyle`, `selectionStyles`) |
| `src/ui/kit.tsx`, `styles.css` | UI kit (Button, IconButton, TextInput, NumberInput, Select, Checkbox, Slider, ColorInput, Row, Section, Tabs, Empty, LayerSelect, FieldSelect, openMenuAt, downloadBlob, pickFiles…) and design tokens |
| `src/app/*` | Shell: title bar, ribbon renderer, docks, view tabs, status bar, overlays |
| `src/features/<module>/` | Feature modules. Each exports `register()` from `index.ts`, wired in `src/features/index.ts` |

Read the core files before writing code; their exported signatures are the contract.

## Rules that keep the model consistent

1. **Geometry is always GeoJSON in EPSG:4326 (lon/lat)** in datasets. The map reprojects for display. Convert with `handle.toGeoJSON(olGeom)` / `handle.fromGeoJSON(geom)` / `handle.toMap(lonLat)` / `handle.toLonLat(coord)`.
2. **A dataset has one geometry family** (`Point` | `LineString` | `Polygon`, Multi* folded in, or `null` for a table). Split mixed input with `splitByGeomType`.
3. **Never mutate features, datasets' arrays, or store state directly.** Change features only through `applyEdits` / `setFieldValues` / field functions (undo + map refresh come for free). Change project state only through `core/store.ts` actions; replace nested objects wholesale (`updateLayer(id, { renderer: {...} })`).
4. Feature ids (`feat.id`, the FID) are numbers, stable, unique per dataset. Selection is `layerId -> fid[]` in `core/ui.ts` (`setSelection`, `getSelection`, `useSelection`, `clearSelection`).
5. OL features created by the runtime carry `get('feat')` (the Feat; read attributes from `feat.properties`) and `get('layerId')`. They do NOT carry attribute properties.
6. `MapDoc.layers[0]` is the top of the Contents list and draws on top. Groups are flat entries with `kind: 'group'`; children point at them with `parentId`.
7. React components read datasets with `useDataset(id)` (re-renders on change) and project state with selector hooks (`useProject(s => …)`, `useMapDoc`, `useLayer`). Never subscribe to the whole `useUi` store in a component (the cursor updates it on every mouse move); use selectors.
8. Long loops over features (> ~20k) must not run on every render: memoise on `useDatasetVersion(id)`.

## Extension points (core/registry.ts)

- `registerCommand({ id, title, icon, run, enabled?, active?, shortcut?, description?, keywords? })`. Everything a user can do is a command so it appears in command search and can sit on the ribbon. `runCommand(id, arg?)`.
- `registerRibbonGroup({ tab, id, title, order, items })`. Items: `button` | `menu` | `split` | `stack` (up to 3 small buttons) | `custom`. An item whose command is not registered renders nothing, so referencing another module's command id is safe.
- `registerPane({ id, title, icon, dock, component })` then `openPane(id, props?)`; the component receives `{ props }`. A `pane.<id>` toggle command is generated automatically.
- `registerDialog({ id, title, width?, component })` then `openDialog(id, props)` (from core/ui); the component receives `{ props, close }`. Use `.dialog-body` and `.dialog-footer` wrappers.
- `registerMapTool({ id, title, icon, cursor?, activate(handle) => cleanup })`: also creates the toggle command `tool.<id>`. Exactly one tool is active (`setTool(id)`, default `'explore'`). `activate` runs when the tool becomes active on the visible map; add OL interactions/listeners there and remove them in the cleanup. Use `handle.setDragPan(false)` if the tool needs plain left-drags (middle-drag always pans). Draw temporary graphics in `handle.scratch`.
- `registerMapPlugin(handle => cleanup)`: runs for every interactive map view on creation (always-on behaviour).
- `registerView({ type, component, icon, title })`: a center-area document view; open with `openView(type, refId)`.
- Feedback: `notify(message, 'info'|'success'|'warning'|'error')`, `setBusy(label|null)`, `showContextMenu(event, items)`.

### Ribbon tabs and group orders

Tabs: `project`, `map`, `insert`, `analysis`, `view`, `edit`, `share`, contextual `layer` (shown when the active Contents layer is a feature layer) and `layout` (shown when a layout view is active).

| Tab | Group (order) | Owner |
| --- | --- | --- |
| project | Project (10): new/open/save/save as; Export (20) | io |
| map | Navigate (10), Basemap+CRS (25), Selection (30), Inquiry (40) | navigate |
| map | Layer (20): Add Data | io |
| map | Labeling (50) | symbology |
| insert | Project (10): New Map, New Layout, New Chart, Group Layer | contents (references `map.new`, `layout.new`, `chart.new`) |
| insert | Data (20): import commands | io |
| analysis | Geoprocessing (10), Tools gallery (20) | gp |
| analysis | Charts (30) | charts |
| view | Windows (10), Appearance (90) | shell |
| edit | all groups | editing |
| share | Export (10): layer / map image export | io |
| share | Print (20) | layout |
| layer | Drawing (10), Labeling (20) | symbology |
| layer | Data (30): table, fields, select by attributes | table |
| layer | Selection (40) + Export (50) | navigate / io |
| layout | all groups | layout |

### Well-known ids (use these exact strings)

Commands. Unless noted, an optional `arg` of `layerId` defaults to the active layer (`useUi.getState().activeLayerId`).

| Command | Owner | Meaning |
| --- | --- | --- |
| `app.undo`, `app.redo`, `map.new` | shell | |
| `project.new`, `project.open`, `project.save`, `project.saveAs` | io | |
| `data.add` | io | Add Data dialog (files, URLs, services) |
| `layer.export` | io | Export a layer's features |
| `layer.symbology`, `layer.labeling` | symbology | Open the Symbology / Labeling pane for a layer |
| `layer.table` | table | Open the attribute table |
| `layer.fields` | table | Fields (schema) dialog |
| `select.byAttributes` | table | Select By Attributes dialog |
| `select.byLocation`, `select.clear`, `select.zoomTo`, `select.all`, `select.invert` | navigate | |
| `layer.zoomTo`, `layer.remove`, `layer.properties`, `layer.rename`, `layer.duplicate`, `layer.addGroup` | contents | |
| `map.crs`, `map.basemap`, `map.zoomFull`, `map.goToXY`, `map.locate` | navigate | |
| `gp.open` | gp | Open Geoprocessing pane; `arg` = tool id to open that tool |
| `layout.new` | layout | Create a layout from the active map and open it |
| `chart.new` | charts | Create a chart for a layer |
| `edit.*` | editing | |

Panes: `contents` (left), `catalog` (right, io), `symbology` (right), `geoprocessing` (right), `table` (bottom; shows `useUi().openTables`, opened with `openTable(layerId)` from core/ui), `attributes` and `create-features` (right, editing), `chart-properties` (right, charts), `layout-element` (right, layout).

Map tools: `explore` (navigate, default), `select-rect`, `select-polygon`, `select-lasso`, `measure-distance`, `measure-area` (navigate), `edit-*` (editing).

## Conventions

- Icons: `lucide-react` only. Styling: CSS variables from `src/ui/styles.css` (`--bg-2`, `--border`, `--text-dim`, `--accent`…); both dark and light themes must work. One CSS file per module, classes prefixed with the module name. Base font is 12px; the UI is dense like a desktop app.
- Panes are column flex containers: optional `.pane-toolbar`, a scrolling `.pane-body` (add `.padded` for forms), optional `.pane-footer`.
- Commands that need a layer/map and have none should `notify(...)` rather than throw.
- User-visible errors go through `notify(msg, 'error')`; never `alert()`.
- No new npm dependencies without asking the lead. Installed: ol, proj4, @turf/turf, shpjs, @mapbox/shp-write, papaparse, jszip, flatgeobuf, jspdf, @tanstack/react-virtual, idb-keyval, world-atlas, topojson-client, simple-statistics, zustand, immer, lucide-react.
- Tests: vitest (`npx vitest run src/features/<module>`), files named `*.test.ts`, node environment (no DOM). Pure logic should be testable without OL or React.
- `window.terrane` exposes `{ store, data, ui, registry, getMapHandle }` for debugging.
