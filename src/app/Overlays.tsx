import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Info, X, XCircle } from 'lucide-react';
import { closeDialog, dismissToast, hideContextMenu, useUi, type MenuItem } from '../core/ui';
import { getDialog } from '../core/registry';
import { cx, IconButton } from '../ui/kit';

function MenuList({ items, x, y, onClose }: { items: MenuItem[]; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
  }, [x, y, items]);
  return (
    <>
      <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
        {items.map((it, i) =>
          it === 'separator' ? (
            <div className="menu-sep" key={i} />
          ) : (
            <button
              key={i}
              type="button"
              className={cx('menu-item', it.danger && 'danger')}
              disabled={it.disabled}
              onMouseEnter={(e) => {
                if (it.submenu) {
                  const r = e.currentTarget.getBoundingClientRect();
                  setSub({ index: i, x: r.right - 2, y: r.top - 4 });
                } else setSub(null);
              }}
              onClick={() => {
                if (it.submenu) return;
                onClose();
                it.onClick?.();
              }}
            >
              <span className="mi-icon">{it.checked ? <Check /> : it.icon}</span>
              <span className="mi-label">{it.label}</span>
              {it.submenu && <ChevronRight size={12} />}
            </button>
          ),
        )}
      </div>
      {sub && (() => {
        const it = items[sub.index];
        return it !== 'separator' && it?.submenu ? <MenuList items={it.submenu} x={sub.x} y={sub.y} onClose={onClose} /> : null;
      })()}
    </>
  );
}

export function ContextMenuHost() {
  const menu = useUi((s) => s.contextMenu);
  useEffect(() => {
    if (!menu) return;
    const close = () => hideContextMenu();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    // Defer so the opening click does not immediately close the menu.
    const t = setTimeout(() => {
      window.addEventListener('mousedown', close);
      window.addEventListener('blur', close);
      window.addEventListener('keydown', key);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', key);
    };
  }, [menu]);
  if (!menu) return null;
  return <MenuList items={menu.items} x={menu.x} y={menu.y} onClose={hideContextMenu} />;
}

export function DialogHost() {
  const dialogs = useUi((s) => s.dialogs);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const top = useUi.getState().dialogs.at(-1);
      if (e.key === 'Escape' && top && !useUi.getState().contextMenu) closeDialog(top.key);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <>
      {dialogs.map((d) => {
        const def = getDialog(d.id);
        if (!def) return null;
        const close = () => closeDialog(d.key);
        const title = typeof def.title === 'function' ? def.title(d.props) : def.title;
        return (
          <div className="dialog-backdrop" key={d.key}>
            <div className="dialog" style={{ width: def.width ?? 460 }} role="dialog" aria-label={title}>
              <div className="dialog-title">
                <span className="grow">{title}</span>
                <IconButton icon={X} title="Close" onClick={close} />
              </div>
              <def.component props={d.props} close={close} />
            </div>
          </div>
        );
      })}
    </>
  );
}

const TOAST_ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };
export function ToastHost() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => {
        const Icon = TOAST_ICON[t.type];
        return (
          <div key={t.id} className={cx('toast', t.type)} onClick={() => dismissToast(t.id)}>
            <Icon />
            <span>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
