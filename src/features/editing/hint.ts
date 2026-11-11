// Small instruction chip shown at the top of the map while an edit tool is active.
import type { MapHandle } from '../../map/handle';

export interface MapHint {
  set(text: string | null): void;
  remove(): void;
}

export function mapHint(handle: MapHandle, text: string | null = null): MapHint {
  const el = document.createElement('div');
  el.className = 'editing-hint';
  const viewport = handle.map.getViewport()!;
  viewport.appendChild(el);
  const set = (t: string | null) => {
    el.textContent = t ?? '';
    el.style.display = t ? '' : 'none';
  };
  set(text);
  return { set, remove: () => el.remove() };
}

export const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};
