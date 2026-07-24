// STEP export engine (D). Claude authors build123d (Python + OpenCascade) code,
// which a small execution service runs to emit a true B-rep STEP file — the
// format that reopens cleanly in Fusion / SolidWorks / FreeCAD.
//
// The service (see step-service/) exposes POST /run {code} -> STEP bytes.

const API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

const BUILD123D_SYSTEM = `You are Chisel's STEP engineer. Turn the request into a build123d (Python) script that builds ONE solid and exports it to STEP.

Output EXACTLY one \`\`\`python code block, nothing else.

Rules:
- Use build123d's builder API. Units are millimetres.
- Assign the final solid to a variable named \`result\` (a Part/Compound/Solid).
- Do NOT write any file yourself and do NOT call export_step — the runner assigns \`result\` and exports it.
- Keep it manufacturable: real wall thickness, no self-intersections, clean booleans.

Example:
\`\`\`python
from build123d import *
with BuildPart() as part:
    Box(40, 40, 20)
    with Locations((0, 0, 0)):
        Hole(radius=5)
result = part.part
\`\`\``;

async function claudePython(apiKey: string, request: string): Promise<string> {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: [{ type: "text", text: BUILD123D_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: request }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const raw = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const fence = raw.match(/```(?:python|py)?\s*\n([\s\S]*?)```/);
  if (!fence) throw new Error("STEP engineer returned no code.");
  return fence[1].trim();
}

export async function generateStep(
  apiKey: string,
  serviceUrl: string,
  secret: string,
  request: string
): Promise<ArrayBuffer> {
  const code = await claudePython(apiKey, request);
  const res = await fetch(`${serviceUrl.replace(/\/$/, "")}/run`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-chisel-secret": secret },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`STEP service ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.arrayBuffer();
}
