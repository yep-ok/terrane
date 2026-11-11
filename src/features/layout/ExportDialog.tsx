// Export dialog: format, resolution and file name.
import { useState } from 'react';
import type { Id } from '../../core/types';
import { useLayoutDoc } from '../../core/store';
import { Button, Row, Select, TextInput } from '../../ui/kit';
import { DPI_OPTIONS, exportLayout, exportPixelSize, safeFileName, type ExportFormat } from './exporter';

export function ExportLayoutDialog({ props, close }: { props: { layoutId: Id; format?: ExportFormat }; close: () => void }) {
  const layout = useLayoutDoc(props.layoutId);
  const [format, setFormat] = useState<ExportFormat>(props.format ?? 'pdf');
  const [dpi, setDpi] = useState(150);
  const [name, setName] = useState(() => safeFileName(layout?.name ?? 'layout'));
  if (!layout)
    return (
      <>
        <div className="dialog-body muted">The layout no longer exists.</div>
        <div className="dialog-footer"><Button onClick={close}>Close</Button></div>
      </>
    );
  const px = exportPixelSize(layout, dpi);
  const mp = (px.width * px.height) / 1e6;
  const run = () => {
    close();
    void exportLayout(layout.id, { format, dpi, fileName: name });
  };
  return (
    <>
      <div className="dialog-body layout-export">
        <Row label="Format">
          <Select value={format} onChange={setFormat} options={[
            { value: 'pdf', label: 'PDF document (.pdf)' },
            { value: 'png', label: 'PNG image (.png)' },
          ]} />
        </Row>
        <Row label="Resolution">
          <Select value={String(dpi)} onChange={(v) => setDpi(Number(v))} options={DPI_OPTIONS.map((d) => ({
            value: String(d), label: `${d} dpi${d === 96 ? ' (screen)' : d === 150 ? ' (draft print)' : ' (print quality)'}`,
          }))} />
        </Row>
        <Row label="File name">
          <TextInput value={name} onChange={setName} onKeyDown={(e) => e.key === 'Enter' && name.trim() && run()} autoFocus />
          <span className="muted">.{format}</span>
        </Row>
        <div className="layout-export-info muted">
          Page {layout.page.width} × {layout.page.height} mm → {px.width.toLocaleString()} × {px.height.toLocaleString()} px ({mp.toFixed(1)} MP).
          {format === 'pdf' && ' The page is embedded as a high-resolution image.'}
          {mp > 60 && <div className="layout-export-warn">Large output: rendering map frames may take a while and use a lot of memory.</div>}
        </div>
      </div>
      <div className="dialog-footer">
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!name.trim()} onClick={run}>Export</Button>
      </div>
    </>
  );
}
