import { Hono, type Context } from "hono";
import { callClaude, verifyModel, type ChatMsg } from "./claude";
import { editContext, repairContext } from "./prompts";
import { identity } from "./auth";
import { listDesigns, getDesign, saveDesign, deleteDesign } from "./db";
import { callGeometryService, GeometryError } from "./step";
import { mcp } from "./mcp";

export interface Env {
  ANTHROPIC_API_KEY: string;
  STEP_SERVICE_URL?: string;
  STEP_SHARED_SECRET?: string;
  MCP_TOKEN?: string;
  DB: D1Database;
  ASSETS: { fetch: typeof fetch };
}

type Vars = { uid: string };

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// BYOK: a user may supply their own Anthropic key (sent as x-user-key). When
// present and well-formed we bill their key instead of ours; otherwise fall
// back to the hosted key. Returns "" if neither is usable.
function resolveKey(c: Context<{ Bindings: Env; Variables: Vars }>): string {
  const own = c.req.header("x-user-key")?.trim();
  if (own && own.startsWith("sk-ant-")) return own;
  return c.env.ANTHROPIC_API_KEY || "";
}
const NO_KEY = { error: "No Anthropic key — add your own in Settings, or set the server ANTHROPIC_API_KEY." } as const;

// Model Context Protocol server: lets people drive Chisel's geometry engine
// from their own Claude/Cursor/etc. using their own quota.
app.route("/mcp", mcp);

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

  const apiKey = resolveKey(c);
  if (!apiKey) return c.json(NO_KEY, 500);
  if (!messages?.length) return c.json({ error: "no messages" }, 400);

  const convo: ChatMsg[] = [];
  if (currentScript?.trim()) {
    convo.push({ role: "user", content: editContext(currentScript) });
    convo.push({ role: "assistant", content: "Understood — I have the current design. What should I change?" });
  }
  convo.push(...messages);

  try {
    const result = await callClaude(apiKey, convo);
    return c.json({ script: result.script, summary: result.summary });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// --- Repair a script that failed to execute -----------------------------------
app.post("/api/repair", async (c) => {
  const { script, error } = await c.req.json<{ script: string; error: string }>();
  const apiKey = resolveKey(c);
  if (!apiKey) return c.json(NO_KEY, 500);
  try {
    const result = await callClaude(apiKey, [
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
  const apiKey = resolveKey(c);
  if (!apiKey) return c.json({ matches: true, critique: "" });
  if (!image || !request) return c.json({ matches: true, critique: "" });
  try {
    const verdict = await verifyModel(apiKey, request, image);
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
