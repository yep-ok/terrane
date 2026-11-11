import { ChevronDown, type LucideIcon } from 'lucide-react';
import { createElement } from 'react';
import {
  getCommand, ribbonGroups, ribbonTabs, runCommand, type Command, type RibbonItem, type RibbonMenuEntry,
} from '../core/registry';
import { setRibbonTab, useUi, type MenuItem } from '../core/ui';
import { useProject } from '../core/store';
import { useHistoryVersion } from '../core/history';
import { useAllDatasets } from '../core/data';
import { cx, openMenuAt } from '../ui/kit';

function menuItems(entries: RibbonMenuEntry[] | (() => RibbonMenuEntry[])): MenuItem[] {
  const list = typeof entries === 'function' ? entries() : entries;
  const out: MenuItem[] = [];
  for (const e of list) {
    if (e === 'separator') {
      out.push('separator');
      continue;
    }
    const ref = typeof e === 'string' ? { command: e } : e;
    const cmd = getCommand(ref.command);
    if (!cmd) continue;
    out.push({
      label: ref.label ?? cmd.title,
      icon: cmd.icon ? createElement(cmd.icon) : undefined,
      disabled: cmd.enabled ? !cmd.enabled() : false,
      checked: cmd.active?.(),
      onClick: () => runCommand(cmd.id, ref.arg),
    });
  }
  return out;
}

function tip(cmd: Command) {
  return [cmd.title + (cmd.shortcut ? ` (${cmd.shortcut})` : ''), cmd.description].filter(Boolean).join('\n');
}

function Face({ icon: Icon, label, size, chevron }: { icon?: LucideIcon; label: string; size: 'large' | 'small'; chevron?: boolean }) {
  return (
    <>
      {Icon && <Icon className="ico" />}
      <span>
        {label}
        {chevron && size === 'large' && <ChevronDown className="chev" style={{ display: 'inline', marginLeft: 2, verticalAlign: -1 }} />}
      </span>
      {chevron && size === 'small' && <ChevronDown className="chev" />}
    </>
  );
}

function Item({ item, forceSmall }: { item: RibbonItem; forceSmall?: boolean }) {
  if (item.type === 'custom') return <>{item.render()}</>;
  if (item.type === 'stack')
    return (
      <div className="rb-stack">
        {item.items.map((it, i) => (
          <Item key={i} item={it} forceSmall />
        ))}
      </div>
    );
  const size = forceSmall ? 'small' : item.size ?? 'large';
  if (item.type === 'menu') {
    return (
      <button type="button" className={cx('rb', size)} title={item.label} onClick={(e) => openMenuAt(e.currentTarget, menuItems(item.items))}>
        <Face icon={item.icon} label={item.label} size={size} chevron />
      </button>
    );
  }
  const cmd = getCommand(item.command);
  if (!cmd) return null;
  const disabled = cmd.enabled ? !cmd.enabled() : false;
  const pressed = cmd.active?.() ?? false;
  const label = item.label ?? cmd.title;
  if (item.type === 'split') {
    return (
      <div className={cx('rb-split', size)}>
        <button type="button" className={cx('rb', size, 'face', pressed && 'pressed')} disabled={disabled} title={tip(cmd)} onClick={() => runCommand(cmd.id)}>
          {cmd.icon && <cmd.icon className="ico" />}
          {size === 'small' && <span>{label}</span>}
        </button>
        <button type="button" className={cx('rb', size, 'arrow')} title={label} onClick={(e) => openMenuAt(e.currentTarget.parentElement!, menuItems(item.items))}>
          {size === 'large' && <span>{label}</span>}
          <ChevronDown className="chev" />
        </button>
      </div>
    );
  }
  return (
    <button type="button" className={cx('rb', size, pressed && 'pressed')} disabled={disabled} title={tip(cmd)} onClick={() => runCommand(cmd.id, item.arg)}>
      <Face icon={cmd.icon} label={label} size={size} />
    </button>
  );
}

export function Ribbon() {
  // Re-render whenever anything that can affect enabled/active state changes.
  // (Selectors, not the whole UI store: cursor moves must not re-render the ribbon.)
  useUi((s) => s.activeTool);
  useUi((s) => s.activeLayerId);
  useUi((s) => s.selection);
  useUi((s) => s.activeViewId);
  useUi((s) => s.views);
  useUi((s) => s.docks);
  useUi((s) => s.openTables);
  useUi((s) => s.theme);
  useProject();
  useHistoryVersion();
  useAllDatasets();
  const current = useUi((s) => s.ribbonTab);
  const collapsed = useUi((s) => s.ribbonCollapsed);
  const tabs = ribbonTabs().filter((t) => !t.visible || t.visible());
  const active = tabs.find((t) => t.id === current) ?? tabs.find((t) => t.id === 'map') ?? tabs[0];
  return (
    <div className="ribbon">
      <div className="ribbon-tabs" onDoubleClick={() => useUi.setState({ ribbonCollapsed: !collapsed })}>
        {tabs.map((t) => (
          <button key={t.id} type="button" className={cx('ribbon-tab', t.id === active?.id && !collapsed && 'active', t.contextual && 'contextual')} onClick={() => setRibbonTab(t.id)}>
            {t.title}
          </button>
        ))}
      </div>
      {!collapsed && active && (
        <div className="ribbon-body">
          {ribbonGroups(active.id).map((g) => (
            <div className="ribbon-group" key={g.id}>
              <div className="ribbon-group-items">
                {g.items.map((it, i) => (
                  <Item key={i} item={it} />
                ))}
              </div>
              <div className="ribbon-group-title">{g.title}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
