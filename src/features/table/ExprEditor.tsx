// Expression editor: multi-line box with clickable field and function lists.
import { useMemo, useRef, useState } from 'react';
import type { Id } from '../../core/types';
import { useDataset } from '../../core/data';
import { fieldRef } from '../../core/store';
import { listFunctions } from '../../core/expr';
import { cx, Select } from '../../ui/kit';
import { FieldTypeIcon } from './shared';

const OPERATORS = ['+', '-', '*', '/', '%', '=', '<>', '<', '>', '(', ')', 'AND', 'OR', 'NOT', 'LIKE', 'IN', 'IS NULL'];

export function ExprEditor({
  datasetId, value, onChange, error, rows = 5, placeholder, listHeight = 130,
}: {
  datasetId: Id | undefined; value: string; onChange: (v: string) => void; error?: string | null;
  rows?: number; placeholder?: string; listHeight?: number;
}) {
  const ds = useDataset(datasetId);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [category, setCategory] = useState('All');
  const [hover, setHover] = useState<string>('');
  const funcs = useMemo(() => listFunctions(), []);
  const categories = useMemo(() => ['All', ...new Set(funcs.map((f) => f.category))], [funcs]);
  const shown = funcs.filter((f) => category === 'All' || f.category === category);

  /** Insert text at the caret; `back` moves the caret left of the end of the inserted text. */
  const insert = (text: string, back = 0) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    const caret = start + text.length - back;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };
  const insertOp = (op: string) => {
    const el = ref.current;
    const before = value.slice(0, el?.selectionStart ?? value.length);
    const pad = /^[A-Z]/.test(op) || ['=', '<>', '<', '>'].includes(op);
    insert(pad ? `${before && !/\s$/.test(before) ? ' ' : ''}${op} ` : op);
  };

  return (
    <div className="tbl-expr">
      <textarea
        ref={ref}
        className={cx('textarea selectable', error && 'invalid')}
        rows={rows}
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="tbl-ops">
        {OPERATORS.map((op) => (
          <button key={op} type="button" className="tbl-op" onClick={() => insertOp(op)}>
            {op}
          </button>
        ))}
      </div>
      <div className="tbl-pickers">
        <div className="tbl-picker">
          <div className="tbl-picker-head">Fields</div>
          <div className="tbl-list" style={{ height: listHeight }}>
            {(ds?.fields ?? []).map((f) => (
              <button key={f.name} type="button" className="tbl-list-item" title={`${f.name} (${f.type})`} onClick={() => insert(fieldRef(f.name))}>
                <FieldTypeIcon type={f.type} />
                <span className="grow tbl-ellipsis">{f.alias ? `${f.alias} (${f.name})` : f.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="tbl-picker">
          <div className="tbl-picker-head">
            <span>Functions</span>
            <Select value={category} onChange={setCategory} options={categories} className="tbl-catselect" />
          </div>
          <div className="tbl-list" style={{ height: listHeight }}>
            {shown.map((f, i) => (
              <button
                key={f.signature + i}
                type="button"
                className="tbl-list-item"
                title={`${f.signature}\n${f.description}`}
                onMouseEnter={() => setHover(`${f.signature}  ${f.description}`)}
                onMouseLeave={() => setHover('')}
                onClick={() => (f.signature.endsWith('()') ? insert(`${f.name}()`) : insert(`${f.name}()`, 1))}
              >
                <span className="grow tbl-ellipsis">{f.name}</span>
                <span className="tbl-faint">{f.category}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="tbl-hint">{hover || 'Click a field or function to insert it. Strings use single or double quotes; [Field Name] for names with spaces.'}</div>
    </div>
  );
}
