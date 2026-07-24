import { Hono } from "hono";
import { callClaude, type ChatMsg } from "./claude";
import { editContext, repairContext } from "./prompts";

interface Env {
  ANTHROPIC_API_KEY: string;
  ASSETS: { fetch: typeof fetch };
}

const app = new Hono<{ Bindings: Env }>();

// --- Generate / edit a design -------------------------------------------------
// The client sends the running chat plus (optionally) the current script. If a
// script exists we prepend an edit-context turn so the model patches it rather
// than starting over. The JSCAD is executed client-side in a sandboxed Web
// Worker; the repair loop lives at /api/repair.
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

// Everything else → static assets / SPA fallback.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
