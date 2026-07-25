import { Hono } from "hono";
import { callClaude, verifyModel, type ChatMsg } from "./claude";
import { editContext, repairContext } from "./prompts";
import { identity } from "./auth";
import { listDesigns, getDesign, saveDesign, deleteDesign } from "./db";
import { callGeometryService, GeometryError } from "./step";

interface Env {
  ANTHROPIC_API_KEY: string;
  STEP_SERVICE_URL?: string;
  STEP_SHARED_SECRET?: string;
  DB: D1Database;
  ASSETS: { fetch: typeof fetch };
}

type Vars = { uid: string };

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// API responses must never be edge-cached (they're per-user and dynamic).
app.use("/api/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});
app.use("/api/*", identity);

// --- Generate / edit a design -------------------------------------------------
app.post("/api/generate", async (c) => {
  const { messages, currentScript } = await c.req.json<{
    messages: ChatMsg[];
    currentScript?: string;
  }>();

  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "ANTHROPIC_API_KEY not set" }, 500);
  if (!messages?.length) return c.json({ error: "no messages" }, 400);

  const convo: ChatMsg[] = [];
  if (currentScript?.trim()) {
    convo.push({ role: "user", content: editContext(currentScript) });
    convo.push({ role: "assistant", content: "Understood — I have the current design. What should I change?" });
  }
  convo.push(...messages);

  try {
    const result = await callClaude(c.env.ANTHROPIC_API_KEY, convo);
    return c.json({ script: result.script, summary: result.summary });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// --- Repair a script that failed to execute -----------------------------------
app.post("/api/repair", async (c) => {
  const { script, error } = await c.req.json<{ script: string; error: string }>();
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "ANTHROPIC_API_KEY not set" }, 500);
  try {
    const result = await callClaude(c.env.ANTHROPIC_API_KEY, [
      { role: "user", content: repairContext(script, error) },
    ]);
    return c.json({ script: result.script, summary: result.summary });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// --- Vision verification (B) --------------------------------------------------
// Client renders the model, snapshots the canvas, and asks: does this match?
app.post("/api/verify", async (c) => {
  const { request, image } = await c.req.json<{ request: string; image: string }>();
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "ANTHROPIC_API_KEY not set" }, 500);
  if (!image || !request) return c.json({ matches: true, critique: "" });
  try {
    const verdict = await verifyModel(c.env.ANTHROPIC_API_KEY, request, image);
    return c.json(verdict);
  } catch {
    return c.json({ matches: true, critique: "" }); // never block the user on a flaky judge
  }
});

// --- Build the preview mesh (tessellate the build123d script) -----------------
// Success → binary STL. Model error → 422 {error: traceback} for the repair loop.
app.post("/api/build", async (c) => {
  const { script, params } = await c.req.json<{ script: string; params?: Record<string, number> }>();
  if (!c.env.STEP_SERVICE_URL) return c.json({ error: "Geometry engine not configured." }, 503);
  try {
    const stl = await callGeometryService(
      c.env.STEP_SERVICE_URL,
      c.env.STEP_SHARED_SECRET ?? "",
      "tessellate",
      script,
      params ?? {}
    );
    return new Response(stl, { headers: { "content-type": "model/stl", "cache-control": "no-store" } });
  } catch (e) {
    const status = e instanceof GeometryError ? e.status : 500;
    return c.json({ error: (e as Error).message }, status === 422 ? 422 : 500);
  }
});

// --- STEP export (same script + params as the preview) ------------------------
app.post("/api/step", async (c) => {
  const { script, params } = await c.req.json<{ script: string; params?: Record<string, number> }>();
  if (!c.env.STEP_SERVICE_URL) return c.json({ error: "Geometry engine not configured." }, 503);
  try {
    const step = await callGeometryService(
      c.env.STEP_SERVICE_URL,
      c.env.STEP_SHARED_SECRET ?? "",
      "step",
      script,
      params ?? {}
    );
    return new Response(step, {
      headers: {
        "content-type": "application/step",
        "content-disposition": 'attachment; filename="chisel-model.step"',
      },
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// --- Persistence (C) ----------------------------------------------------------
app.get("/api/designs", async (c) => {
  const designs = await listDesigns(c.env.DB, c.get("uid"));
  return c.json({ designs });
});

app.get("/api/designs/:id", async (c) => {
  const row = await getDesign(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({
    id: row.id,
    title: row.title,
    script: row.script,
    messages: JSON.parse(row.messages),
    mine: row.uid === c.get("uid"),
  });
});

app.post("/api/designs", async (c) => {
  const body = await c.req.json<{ id?: string; title: string; script: string; messages: unknown }>();
  const id = await saveDesign(c.env.DB, c.get("uid"), body, Date.now());
  return c.json({ id });
});

app.delete("/api/designs/:id", async (c) => {
  const ok = await deleteDesign(c.env.DB, c.get("uid"), c.req.param("id"));
  return c.json({ ok });
});

// Everything else → static assets / SPA fallback.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
