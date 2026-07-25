import { SYSTEM_PROMPT, VERIFY_SYSTEM } from "./prompts";

// Default to Sonnet 4.6 for snappy chat latency. Opus 4.8 gives noticeably better
// geometric reasoning for hard parts — flip MODEL if quality matters more than speed.
const MODEL = "claude-sonnet-4-6";
const API = "https://api.anthropic.com/v1/messages";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export interface ModelResult {
  script: string;
  summary: string;
  raw: string;
}

// Extract the single ```javascript block Chisel's contract requires, plus any
// one-line prose the model put before it (used as the chat summary).
function parse(raw: string): ModelResult {
  const fence = raw.match(/```(?:python|py|javascript|js)?\s*\n([\s\S]*?)```/);
  const script = fence ? fence[1].trim() : "";
  const summary = raw.split("```")[0].trim() || "Here's your model.";
  return { script, summary, raw };
}

export async function callClaude(apiKey: string, messages: ChatMsg[]): Promise<ModelResult> {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      // Prompt-cache the big system prompt — it's identical every turn.
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const raw = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
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
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
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
    }),
  });
  if (!res.ok) throw new Error(`Verify API ${res.status}`);
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const raw = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const json = raw.match(/\{[\s\S]*\}/);
  if (!json) return { matches: true, critique: "" }; // fail open — never block on a flaky judge
  try {
    const v = JSON.parse(json[0]) as Verdict;
    return { matches: !!v.matches, critique: v.critique || "" };
  } catch {
    return { matches: true, critique: "" };
  }
}
