import { SYSTEM_PROMPT, VERIFY_SYSTEM } from "./prompts";

// Primary does the heavy geometric reasoning; on overload / rate-limit / server
// errors we automatically retry on the cheaper, faster Haiku so the user still
// gets a part instead of a 529. Vision verify is a lenient yes/no judge, so it
// runs on Haiku always — no need to burn Sonnet on it.
const MODEL_PRIMARY = "claude-sonnet-4-6";
const MODEL_FALLBACK = "claude-haiku-4-5";
const VERIFY_MODEL = "claude-haiku-4-5";
const API = "https://api.anthropic.com/v1/messages";

// Statuses worth retrying on the fallback model (overloaded / throttled / 5xx).
const FALLBACK_STATUS = new Set([429, 500, 502, 503, 529]);

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export interface ModelResult {
  script: string;
  summary: string;
  raw: string;
}

function post(apiKey: string, model: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, ...body }),
  });
}

// Extract the single ```python block Chisel's contract requires, plus any
// one-line prose the model put before it (used as the chat summary).
function parse(raw: string): ModelResult {
  const fence = raw.match(/```(?:python|py|javascript|js)?\s*\n([\s\S]*?)```/);
  const script = fence ? fence[1].trim() : "";
  const summary = raw.split("```")[0].trim() || "Here's your model.";
  return { script, summary, raw };
}

function textOf(data: { content: Array<{ type: string; text?: string }> }): string {
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

export async function callClaude(apiKey: string, messages: ChatMsg[]): Promise<ModelResult> {
  const body = {
    max_tokens: 8000,
    // Prompt-cache the big system prompt — it's identical every turn.
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };

  let res = await post(apiKey, MODEL_PRIMARY, body);
  if (!res.ok && FALLBACK_STATUS.has(res.status)) {
    res = await post(apiKey, MODEL_FALLBACK, body);
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 500)}`);
  }

  const raw = textOf(await res.json());
  const parsed = parse(raw);
  if (!parsed.script) throw new Error("Model returned no code block.");
  return parsed;
}

export interface Verdict {
  matches: boolean;
  critique: string;
}

// Vision check: does the rendered model match the request? pngDataUrl is a
// "data:image/png;base64,..." string captured from the WebGL canvas.
export async function verifyModel(
  apiKey: string,
  request: string,
  pngDataUrl: string
): Promise<Verdict> {
  const b64 = pngDataUrl.replace(/^data:image\/png;base64,/, "");
  const res = await post(apiKey, VERIFY_MODEL, {
    max_tokens: 300,
    system: [{ type: "text", text: VERIFY_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
          { type: "text", text: `The user asked for: "${request}". Does this model match?` },
        ],
      },
    ],
  });
  if (!res.ok) throw new Error(`Verify API ${res.status}`);
  const raw = textOf(await res.json());
  const json = raw.match(/\{[\s\S]*\}/);
  if (!json) return { matches: true, critique: "" }; // fail open — never block on a flaky judge
  try {
    const v = JSON.parse(json[0]) as Verdict;
    return { matches: !!v.matches, critique: v.critique || "" };
  } catch {
    return { matches: true, critique: "" };
  }
}
