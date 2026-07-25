// Client for the build123d geometry service (on the VM behind a tunnel).
// Same code + params drives BOTH the STL preview (/tessellate) and the STEP
// export (/step), so what the user sees is exactly what they download.
//
// A 422 carries the Python traceback for a bad model — surfaced to the repair loop.

export class GeometryError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function callGeometryService(
  serviceUrl: string,
  secret: string,
  path: "tessellate" | "step",
  code: string,
  params: Record<string, number>
): Promise<ArrayBuffer> {
  const res = await fetch(`${serviceUrl.replace(/\/$/, "")}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-chisel-secret": secret },
    body: JSON.stringify({ code, params: params ?? {} }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { detail?: string };
      detail = j.detail ?? "";
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new GeometryError(res.status, detail.slice(0, 900) || `service ${res.status}`);
  }
  return res.arrayBuffer();
}
