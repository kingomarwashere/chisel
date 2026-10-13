import { SYSTEM_PROMPT } from "./prompts";
import type { ChatMsg, ModelResult } from "./claude";

// Radical Commons provider — the free "pooled credits" path used when a user has
// no Anthropic key. Commons (commons.theradicalparty.com) is an OpenAI-compatible
// gateway over donated compute, so we translate Chisel's Anthropic-shaped call
// into a /v1/chat/completions request. No client auth: the pool foots the bill.
const DEFAULT_URL = "https://commons.theradicalparty.com";

// Qwen Coder handles build123d Python best; Llama 3.3 70B is the general fallback
// when the coder pool is exhausted or erroring. Both are live house models.
const MODEL_PRIMARY = "@cf/qwen/qwen2.5-coder-32b-instruct";
const MODEL_FALLBACK = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Raw model IDs → friendly labels shown in the UI.
const LABELS: Record<string, string> = {
  "@cf/qwen/qwen2.5-coder-32b-instruct": "Qwen2.5 Coder 32B",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": "Llama 3.3 70B",
};
const labelFor = (id: string): string => LABELS[id] ?? id;

interface CommonsEnv {
  COMMONS_URL?: string;
}

// Extract the script. Prefer a fenced ```python block (the contract), but the
// pooled models sometimes drop the fence — so if there isn't one, salvage the
// raw Python when it clearly looks like a build123d script. Keeps weaker models
// usable instead of failing the whole request on a formatting slip.
function parse(raw: string): ModelResult {
  const fence = raw.match(/```(?:python|py|javascript|js)?\s*\n([\s\S]*?)```/);
  if (fence) {
    return { script: fence[1].trim(), summary: raw.split("```")[0].trim() || "Here's your model.", raw };
  }
  if (/\b(from\s+build123d|import\s+build123d|result\s*=)/.test(raw)) {
    const lines = raw.split("\n");
    const start = lines.findIndex((l) => /^\s*(#|from\s|import\s|p\s*=|with\s|result\b)/.test(l));
    const script = (start >= 0 ? lines.slice(start).join("\n") : raw).trim();
    const summary = start > 0 ? lines.slice(0, start).join(" ").trim() : "Here's your model.";
    return { script, summary: summary || "Here's your model.", raw };
  }
  return { script: "", summary: raw.trim() || "Here's your model.", raw };
}

function chatUrl(env: CommonsEnv): string {
  return (env.COMMONS_URL || DEFAULT_URL).replace(/\/$/, "") + "/v1/chat/completions";
}

function post(url: string, model: string, messages: Array<{ role: string; content: string }>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 8000, messages }),
  });
}

export async function callCommons(env: CommonsEnv, messages: ChatMsg[]): Promise<ModelResult> {
  const url = chatUrl(env);
  // Anthropic's separate `system` field → an OpenAI system message.
  const oa = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  // Weaker pooled models are non-deterministic about the code-block contract, so
  // try a few times across models and take the first attempt that yields a script.
  const attempts = [MODEL_PRIMARY, MODEL_PRIMARY, MODEL_FALLBACK, MODEL_FALLBACK];
  let lastErr = "no capacity";
  for (const model of attempts) {
    const res = await post(url, model, oa);
    if (!res.ok) {
      lastErr = `Commons ${res.status}: ${(await res.text()).slice(0, 300)}`;
      continue;
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = parse(data.choices?.[0]?.message?.content ?? "");
    if (parsed.script) return { ...parsed, model: labelFor(model) };
    lastErr = "model returned no usable code";
  }
  throw new Error(lastErr);
}
