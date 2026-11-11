// Small helpers shared by the table pane and its dialogs.
import { Binary, Calendar, Hash, ToggleLeft, Type } from 'lucide-react';
import type { FieldType, Id } from '../../core/types';
import { findLayer } from '../../core/store';
import { getMapHandle } from '../../map/handle';

export const TYPE_LABEL: Record<FieldType, string> = {
  string: 'Text',
  number: 'Decimal',
  integer: 'Integer',
  date: 'Date',
  boolean: 'Boolean',
};
export const TYPE_OPTIONS = (Object.keys(TYPE_LABEL) as FieldType[]).map((value) => ({ value, label: TYPE_LABEL[value] }));

export function FieldTypeIcon({ type, size = 12 }: { type: FieldType; size?: number }) {
  const props = { size, className: 'tbl-typeicon', 'aria-label': TYPE_LABEL[type] };
  switch (type) {
    case 'number':
      return <Hash {...props} />;
    case 'integer':
      return <Binary {...props} />;
    case 'date':
      return <Calendar {...props} />;
    case 'boolean':
      return <ToggleLeft {...props} />;
    default:
      return <Type {...props} />;
  }
}

/** Live handle of the map that contains the layer (falls back to the active map). */
export function mapHandleFor(layerId: Id) {
  return getMapHandle(findLayer(layerId)?.map.id) ?? getMapHandle();
}
