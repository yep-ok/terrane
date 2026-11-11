// Geoprocessing worker: runs one tool off the main thread. Pure tool code only.
import { runToolById } from './exec';
import { ToolError } from './types';

const ctx: any = self;

ctx.onmessage = (e: MessageEvent) => {
  const { toolId, inputs, params } = e.data;
  try {
    const result = runToolById(toolId, inputs, params, {
      progress: (fraction, message) => ctx.postMessage({ type: 'progress', fraction, message }),
      message: (text, level) => ctx.postMessage({ type: 'message', text, level }),
    });
    ctx.postMessage({ type: 'done', result });
  } catch (err: any) {
    ctx.postMessage({ type: 'error', message: err?.message ?? String(err), user: err instanceof ToolError });
  }
};
