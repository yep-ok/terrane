// Small shared dialogs: confirm and prompt (promise based).
import { useEffect, useRef, useState } from 'react';
import { Button, TextInput } from '../../../ui/kit';
import { openDialog } from '../../../core/ui';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  /** Extra button that resolves to 'alt' (e.g. "Don't save"). */
  altLabel?: string;
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => openDialog('io.confirm', { ...opts, resolve }));
}

/** Three-way variant: true = primary, 'alt' = secondary button, false = cancel. */
export function choiceDialog(opts: ConfirmOptions): Promise<boolean | 'alt'> {
  return new Promise((resolve) => openDialog('io.confirm', { ...opts, resolve }));
}

export function ConfirmDialog({ props, close }: { props: ConfirmOptions & { resolve: (v: boolean | 'alt') => void }; close: () => void }) {
  const done = useRef(false);
  const finish = (v: boolean | 'alt') => {
    if (done.current) return;
    done.current = true;
    props.resolve(v);
    close();
  };
  useEffect(() => () => {
    if (!done.current) {
      done.current = true;
      props.resolve(false);
    }
  }, []);
  return (
    <>
      <div className="dialog-body io-confirm selectable">{props.message}</div>
      <div className="dialog-footer">
        <Button onClick={() => finish(false)}>Cancel</Button>
        {props.altLabel && <Button onClick={() => finish('alt')}>{props.altLabel}</Button>}
        <Button variant={props.danger ? 'danger' : 'primary'} autoFocus onClick={() => finish(true)}>
          {props.confirmLabel ?? 'OK'}
        </Button>
      </div>
    </>
  );
}

export interface PromptOptions {
  title: string;
  label: string;
  value?: string;
  confirmLabel?: string;
  validate?: (v: string) => string | null;
}

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => openDialog('io.prompt', { ...opts, resolve }));
}

export function PromptDialog({ props, close }: { props: PromptOptions & { resolve: (v: string | null) => void }; close: () => void }) {
  const [value, setValue] = useState(props.value ?? '');
  const done = useRef(false);
  const error = props.validate ? props.validate(value) : value.trim() ? null : 'Enter a name';
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    props.resolve(v);
    close();
  };
  useEffect(() => () => {
    if (!done.current) {
      done.current = true;
      props.resolve(null);
    }
  }, []);
  return (
    <>
      <div className="dialog-body">
        <div className="vstack">
          <label className="muted">{props.label}</label>
          <TextInput value={value} onChange={setValue} autoFocus onFocus={(e) => e.target.select()} invalid={!!error && value !== (props.value ?? '')} onKeyDown={(e) => e.key === 'Enter' && !error && finish(value.trim())} />
          {error && value !== (props.value ?? '') && <div className="error-text">{error}</div>}
        </div>
      </div>
      <div className="dialog-footer">
        <Button onClick={() => finish(null)}>Cancel</Button>
        <Button variant="primary" disabled={!!error} onClick={() => finish(value.trim())}>
          {props.confirmLabel ?? 'OK'}
        </Button>
      </div>
    </>
  );
}
