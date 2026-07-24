/// <reference lib="webworker" />
// Sandboxed execution of model-generated JSCAD. Runs in a Web Worker with no DOM
// access — the isolation boundary for untrusted code. Receives a script + params,
// returns binary STL (transferred, zero-copy) or a structured error for the
// repair loop.
import * as jscadModule from "@jscad/modeling";
// @ts-expect-error — no bundled types
import stlSerializer from "@jscad/stl-serializer";

// Under ESM interop the real API lands on `.default` (Node) or the namespace
// itself (some bundlers). Normalize so scripts always get { primitives, ... }.
const jscad = (jscadModule as Record<string, unknown>).default ?? jscadModule;

(globalThis as Record<string, unknown>).jscad = jscad;

interface RunMsg {
  id: number;
  script: string;
  params: Record<string, number>;
}

self.onmessage = (e: MessageEvent<RunMsg>) => {
  const { id, script, params } = e.data;
  try {
    // Compile the script body and pull out main(). `jscad` and `params` are the
    // only things in scope besides JS built-ins.
    const factory = new Function(
      "jscad",
      "params",
      `${script}\n;
       if (typeof main !== "function") throw new Error("Script must define a main(params) function.");
       return main(params || {});`
    );
    const geom = factory(jscad, params);
    if (!geom) throw new Error("main(params) returned nothing.");

    const geoms = Array.isArray(geom) ? geom : [geom];
    // Binary STL comes back as chunks [header(80), count(4), body...] — concat
    // them into one contiguous ArrayBuffer.
    const chunks = stlSerializer.serialize({ binary: true }, ...geoms) as ArrayBuffer[];
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(new Uint8Array(c as ArrayBuffer), offset);
      offset += c.byteLength;
    }
    const buf = merged.buffer;
    self.postMessage({ id, stl: buf }, [buf]);
  } catch (err) {
    const e = err as Error;
    self.postMessage({ id, error: e.stack || e.message || String(err) });
  }
};
