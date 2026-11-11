// Persisted geoprocessing history and user preferences (favourites).
import { create } from 'zustand';

export interface LogLine {
  /** Milliseconds since the run started. */
  at: number;
  level: 'info' | 'warning' | 'error' | 'success';
  text: string;
}

export interface HistoryEntry {
  id: string;
  toolId: string;
  toolName: string;
  params: Record<string, any>;
  status: 'success' | 'failed' | 'cancelled';
  startedAt: number;
  elapsedMs: number;
  output?: string;
  count?: number;
  lines: LogLine[];
}

const HISTORY_KEY = 'terrane.gp.history';
const FAV_KEY = 'terrane.gp.favorites';
const LIMIT = 100;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable */
  }
}

interface GpPrefs {
  history: HistoryEntry[];
  favorites: string[];
}

export const useGpPrefs = create<GpPrefs>()(() => ({
  history: load<HistoryEntry[]>(HISTORY_KEY, []),
  favorites: load<string[]>(FAV_KEY, ['buffer', 'clip', 'intersect', 'dissolve']),
}));

export function addHistory(entry: HistoryEntry) {
  const history = [entry, ...useGpPrefs.getState().history].slice(0, LIMIT);
  useGpPrefs.setState({ history });
  save(HISTORY_KEY, history);
}
export function removeHistory(id: string) {
  const history = useGpPrefs.getState().history.filter((h) => h.id !== id);
  useGpPrefs.setState({ history });
  save(HISTORY_KEY, history);
}
export function clearHistory() {
  useGpPrefs.setState({ history: [] });
  save(HISTORY_KEY, []);
}
export function toggleFavorite(toolId: string) {
  const cur = useGpPrefs.getState().favorites;
  const favorites = cur.includes(toolId) ? cur.filter((x) => x !== toolId) : [...cur, toolId];
  useGpPrefs.setState({ favorites });
  save(FAV_KEY, favorites);
}

/** Tool ids ordered by most recent use. */
export function recentToolIds(history: HistoryEntry[], max = 6): string[] {
  const out: string[] = [];
  for (const h of history) if (!out.includes(h.toolId)) out.push(h.toolId);
  return out.slice(0, max);
}
