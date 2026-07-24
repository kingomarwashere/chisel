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
