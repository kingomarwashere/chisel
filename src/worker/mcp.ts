// Chisel as a Model Context Protocol server.
//
// This lets someone drive Chisel's CAD engine from their OWN AI client (Claude
// Desktop, Claude.ai connectors, Cursor, …) using their OWN quota — their model
// writes the build123d script, Chisel just validates + exports the real B-rep.
// That offloads all the language-model cost to the user's client.
//
// Transport: Streamable HTTP (single endpoint, stateless). We answer each
// JSON-RPC request with a plain JSON response — no SSE session needed for a
// request/response tool server.

import { Hono, type Context } from "hono";
import { SYSTEM_PROMPT } from "./prompts";
import { callGeometryService, GeometryError } from "./step";

interface Env {
  STEP_SERVICE_URL?: string;
  STEP_SHARED_SECRET?: string;
  MCP_TOKEN?: string;
}

const PROTOCOL_VERSION = "2024-11-05";

// Compact contract embedded in the tool schema so a client model writes a valid
// script even without first fetching the full guide.
const SCRIPT_HINT =
  "A build123d (Python) script. Assign the final solid to `result`. Read tunables " +
  "from an injected `params` dict. Import ONLY build123d; never write files or call " +
  "export_*. Units are millimetres. Call get_build123d_guide for the full contract.";

const TOOLS = [
  {
    name: "build_part",
    description:
      "Validate and tessellate a parametric 3D CAD part from a build123d script. " +
      "Returns success + triangle/vertex counts on success, or the Python traceback " +
      "on failure so you can fix the script and call again. Use this to check a script " +
      "compiles before exporting.",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", description: SCRIPT_HINT },
        params: {
          type: "object",
          description: "Optional numeric overrides for the script's params dict.",
          additionalProperties: { type: "number" },
        },
      },
      required: ["script"],
    },
  },
  {
    name: "export_step",
    description:
      "Export a build123d script to a STEP (ISO 10303) B-rep file, editable in " +
      "Fusion 360 / SolidWorks / FreeCAD. Returns the STEP file as text.",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", description: SCRIPT_HINT },
        params: {
          type: "object",
          description: "Optional numeric overrides for the script's params dict.",
          additionalProperties: { type: "number" },
        },
      },
      required: ["script"],
    },
  },
  {
    name: "get_build123d_guide",
    description:
      "Return Chisel's full build123d authoring contract and API cheatsheet. Read this " +
      "before writing a script so build_part / export_step accept your output.",
    inputSchema: { type: "object", properties: {} },
  },
];

const PROMPTS = [
  {
    name: "write_cad",
    description: "Load Chisel's build123d authoring contract as a system prompt.",
    arguments: [],
  },
];

type ToolText = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
const ok = (text: string): ToolText => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolText => ({ content: [{ type: "text", text }], isError: true });

function triCount(stl: ArrayBuffer): number {
  if (stl.byteLength < 84) return 0;
  return new DataView(stl).getUint32(80, true); // binary STL: uint32 after 80-byte header
}

async function runTool(c: Context<{ Bindings: Env }>, name: string, args: Record<string, unknown>): Promise<ToolText> {
  if (name === "get_build123d_guide") return ok(SYSTEM_PROMPT);

  const url = c.env.STEP_SERVICE_URL;
  if (!url) return fail("Geometry engine not configured on this server.");
  const secret = c.env.STEP_SHARED_SECRET ?? "";
  const script = typeof args.script === "string" ? args.script : "";
  const params = (args.params as Record<string, number>) ?? {};
  if (!script.trim()) return fail("Missing `script`.");

  try {
    if (name === "build_part") {
      const stl = await callGeometryService(url, secret, "tessellate", script, params);
      const tris = triCount(stl);
      return ok(`✓ Built successfully — ${tris.toLocaleString()} triangles. The script is valid; call export_step for a STEP file.`);
    }
    if (name === "export_step") {
      const step = await callGeometryService(url, secret, "step", script, params);
      return ok(new TextDecoder().decode(step));
    }
    return fail(`Unknown tool: ${name}`);
  } catch (e) {
    // 422 = the script threw in build123d → hand the traceback back so the client model repairs it.
    const msg = e instanceof GeometryError ? e.message : (e as Error).message;
    return fail(`Build failed:\n${msg}`);
  }
}

export const mcp = new Hono<{ Bindings: Env }>();

// Remote connectors (e.g. Claude.ai in the browser) need permissive CORS.
mcp.use("*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "content-type, authorization, mcp-session-id, mcp-protocol-version");
  c.header("Cache-Control", "no-store");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});

// No server-initiated streams — GET has nothing to offer.
mcp.get("/", (c) => c.text("Method Not Allowed", 405));

mcp.post("/", async (c) => {
  // Optional bearer gate: if MCP_TOKEN is set, require it.
  if (c.env.MCP_TOKEN) {
    const auth = c.req.header("authorization") ?? "";
    if (auth !== `Bearer ${c.env.MCP_TOKEN}`) {
      return c.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, 401);
    }
  }

  let msg: { id?: string | number | null; method?: string; params?: any };
  try {
    msg = await c.req.json();
  } catch {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }

  const { id, method, params } = msg;
  const reply = (result: unknown) => c.json({ jsonrpc: "2.0", id, result });
  const rpcErr = (code: number, message: string) => c.json({ jsonrpc: "2.0", id, error: { code, message } });

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {}, prompts: {} },
        serverInfo: { name: "chisel", version: "1.0.0" },
      });

    // Notifications carry no id and expect no JSON-RPC response body.
    case "notifications/initialized":
    case "notifications/cancelled":
      return c.body(null, 202);

    case "ping":
      return reply({});

    case "tools/list":
      return reply({ tools: TOOLS });

    case "tools/call": {
      const name = params?.name as string;
      const args = (params?.arguments as Record<string, unknown>) ?? {};
      if (!TOOLS.some((t) => t.name === name)) return rpcErr(-32602, `Unknown tool: ${name}`);
      return reply(await runTool(c, name, args));
    }

    case "prompts/list":
      return reply({ prompts: PROMPTS });

    case "prompts/get":
      if (params?.name !== "write_cad") return rpcErr(-32602, `Unknown prompt: ${params?.name}`);
      return reply({
        description: "Chisel's build123d authoring contract.",
        messages: [{ role: "user", content: { type: "text", text: SYSTEM_PROMPT } }],
      });

    default:
      return rpcErr(-32601, `Method not found: ${method}`);
  }
});
