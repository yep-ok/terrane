// io module entry point.
import { addMap } from '../../core/store';
import { openView } from '../../core/ui';

export function register() {}

/** Called once at boot after all modules registered: restore the last session or create a starter project. */
export async function startup(): Promise<void> {
  const map = addMap();
  openView('map', map.id);
}
