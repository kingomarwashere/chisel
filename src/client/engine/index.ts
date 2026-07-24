// Main-thread wrapper around the JSCAD Web Worker. Single long-lived worker,
// requests keyed by id so slider spam can't cross wires.

export interface Param {
  name: string;
  value: number;
  label: string;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./jscad.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<{ id: number; stl?: ArrayBuffer; error?: string }>) => {
    const { id, stl, error } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.reject(new Error(error));
    else p.resolve(stl!);
  };
  return worker;
}

export function runJscad(script: string, params: Record<string, number>): Promise<ArrayBuffer> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, script, params });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("Model execution timed out (10s)."));
      }
    }, 10_000);
  });
}

// Pull `// @param name default // label` declarations out of a script so the UI
// can render sliders. Mirrors the contract taught in the system prompt.
export function parseParams(script: string): Param[] {
  const out: Param[] = [];
  const re = /\/\/\s*@param\s+(\w+)\s+(-?[\d.]+)\s*(?:\/\/\s*(.*))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script))) {
    out.push({ name: m[1], value: parseFloat(m[2]), label: (m[3] || m[1]).trim() });
  }
  return out;
}
