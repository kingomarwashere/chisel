// Geometry now comes from the server: build123d runs on the VM and returns an
// STL mesh. Same script + params also produces the STEP export, so the preview
// matches the download. (The old client-side JSCAD worker is retired.)

export interface Param {
  name: string;
  value: number;
  label: string;
}

// POST the build123d script + params to the Worker, get back a binary STL.
// Throws with the Python traceback on a model error (drives the repair loop).
export async function buildModel(script: string, params: Record<string, number>): Promise<ArrayBuffer> {
  const res = await fetch("/api/build", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ script, params }),
  });
  if (res.ok && (res.headers.get("content-type") || "").includes("stl")) {
    return res.arrayBuffer();
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(data.error || `build failed (${res.status})`);
}

// Pull `# @param name default // label` (or `// @param ...`) declarations out of a
// script so the UI can render sliders. Matches the contract in the system prompt.
export function parseParams(script: string): Param[] {
  const out: Param[] = [];
  const re = /(?:#|\/\/)\s*@param\s+(\w+)\s+(-?[\d.]+)\s*(?:\/\/\s*(.*))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script))) {
    out.push({ name: m[1], value: parseFloat(m[2]), label: (m[3] || m[1]).trim() });
  }
  return out;
}
