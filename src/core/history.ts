// Global undo/redo stack. Data edits push entries automatically (see data.ts applyEdits).
import { useSyncExternalStore } from 'react';

export interface UndoEntry {
  label: string;
  undo(): void;
  redo(): void;
}

const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];
const listeners = new Set<() => void>();
let version = 0;
let suspended = 0;
const LIMIT = 200;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function pushUndo(entry: UndoEntry) {
  if (suspended) return;
  undoStack.push(entry);
  if (undoStack.length > LIMIT) undoStack.shift();
  redoStack.length = 0;
  emit();
}

/** Run fn without recording undo entries (used while undoing/redoing and for bulk loads). */
export function withoutHistory<T>(fn: () => T): T {
  suspended++;
  try {
    return fn();
  } finally {
    suspended--;
  }
}

/** Group every entry pushed during fn into one undo step. */
export function transaction<T>(label: string, fn: () => T): T {
  const start = undoStack.length;
  const result = fn();
  const entries = undoStack.splice(start);
  if (entries.length) {
    pushUndo({
      label,
      undo: () => [...entries].reverse().forEach((e) => e.undo()),
      redo: () => entries.forEach((e) => e.redo()),
    });
  }
  return result;
}

export function undo() {
  const e = undoStack.pop();
  if (!e) return;
  withoutHistory(() => e.undo());
  redoStack.push(e);
  emit();
}
export function redo() {
  const e = redoStack.pop();
  if (!e) return;
  withoutHistory(() => e.redo());
  undoStack.push(e);
  emit();
}
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
export const undoLabel = () => undoStack[undoStack.length - 1]?.label;
export const redoLabel = () => redoStack[redoStack.length - 1]?.label;
export function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  emit();
}
export function subscribeHistory(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
/** Re-renders when the undo/redo stacks change. */
export function useHistoryVersion() {
  return useSyncExternalStore(subscribeHistory, () => version);
}
