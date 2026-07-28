# ◢ Chisel — AI CAD

**Say it. Shape it.** Message what you want built; Claude writes a parametric CAD
script, it runs in a sandbox, and it appears in a live 3D viewport — exportable
to real CAD.

The core idea: **the design *is* a parametric script.** Chat edits patch the
script; sliders tune its parameters; export emits the geometry. Everything —
editing, versioning, parametrics — falls out of that one choice.

**Live:** https://chisel.theradicalparty.com · pushes to `main` auto-deploy via
the Forgejo post-receive hook.

## Architecture (v0 — MVP)

```
React + react-three-fiber (chat + 3D viewport)
        │  POST /api/generate | /api/repair
        ▼
Hono Worker ── Claude (claude-sonnet-4-6, prompt-cached system prompt)
        │
        ▼  returns a JSCAD script
Sandboxed Web Worker (src/client/engine) ── runs script → binary STL
        ▼
three.js viewport  +  Download STL
```

- **Kernel:** JSCAD (`@jscad/modeling`), pure JS — runs client-side in a Web
  Worker isolated from the DOM. Exports STL now.
- **Agent loop:** generate → execute → on error, `/api/repair` (up to 3×) before
  the user sees anything.
- **Parameters:** `// @param name default // label` comments in the script become
  live sliders that re-run locally with no API call.

## Develop

```bash
npm install
wrangler secret put ANTHROPIC_API_KEY   # or add to .dev.vars for local dev
# terminal 1 — Worker API on :8787
npm run dev
# terminal 2 — Vite client on :5173 (proxies /api → :8787)
npm run dev:client
```

Open http://localhost:5173.

## Deploy

```bash
npm run deploy        # builds client → ./public, then wrangler deploy
```

Serves at `chisel.theradicalparty.com`.

## Use your own AI

Two ways to run Chisel on your own model quota instead of the hosted key.

### Bring your own key (in the app)

Click the ⚙ gear → paste an [Anthropic API key](https://console.anthropic.com/settings/keys).
It's stored only in your browser (`localStorage`) and sent as `x-user-key`; the
Worker prefers it over the hosted key for generate / repair / verify. Remove it
anytime to fall back to the shared key.

### MCP server (drive Chisel from your own client)

Chisel is a Model Context Protocol server at **`https://chisel.theradicalparty.com/mcp`**
(Streamable HTTP, stateless JSON-RPC). Your own client's model writes the
build123d script; Chisel validates and exports the real B-rep — so all the
language-model cost is on *your* account.

Tools: `build_part` (validate/tessellate → triangle count or the traceback to
self-repair), `export_step` (→ STEP file), `get_build123d_guide` (the full
authoring contract). Prompt: `write_cad`.

**Claude.ai** (Pro/Max/Team/Enterprise) — Settings → Connectors → *Add custom
connector* → paste the `/mcp` URL.

**Claude Desktop** — add to `claude_desktop_config.json` (remote servers go
through the `mcp-remote` bridge):

```json
{
  "mcpServers": {
    "chisel": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://chisel.theradicalparty.com/mcp"]
    }
  }
}
```

**Cursor** — add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "chisel": { "url": "https://chisel.theradicalparty.com/mcp" }
  }
}
```

Then just ask: *"Design an M4 bolt 20mm long with a hex head, build it, and
export a STEP."* The client will call `get_build123d_guide`, write a script,
`build_part` to check it (repairing on any traceback), then `export_step`.

**Locking it down (optional).** The endpoint is open so anyone can connect. To
require a bearer token: `wrangler secret put MCP_TOKEN`, then have each client
send `Authorization: Bearer <token>` (Claude.ai/Cursor: add it as a custom
header; Claude Desktop: `mcp-remote … --header "Authorization: Bearer <token>"`).
Leaving it open keeps the "any user, their own AI" story — locking it makes it
private to you.

## Roadmap

- **v1** — conversational edits as source-of-truth, vision verification (render →
  "does this match?"), auth + saved projects (D1/R2), 3MF/OBJ export.
- **v2** — **STEP B-rep engine** via build123d/OpenCascade in a Cloudflare
  Container/Sandbox, so exports reopen cleanly in Fusion/SolidWorks/FreeCAD.
  Version history & branching.
- **v3** — assemblies & mates, dimension queries ("how tall is it?"),
  manufacturing hints (3D print / CNC).

## Layout

```
src/worker/     Hono API — Claude orchestration, prompts, repair
src/client/     React app, 3D viewer, JSCAD Web Worker engine
```
