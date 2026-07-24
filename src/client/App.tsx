import { useCallback, useEffect, useRef, useState } from "react";
import { Viewer } from "./components/Viewer";
import { runJscad, parseParams, type Param } from "./engine";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const MAX_REPAIRS = 3;

interface GenResponse {
  script?: string;
  summary?: string;
  error?: string;
}

export default function App() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [script, setScript] = useState("");
  const [params, setParams] = useState<Param[]>([]);
  const [stl, setStl] = useState<ArrayBuffer | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, status]);

  const paramValues = useCallback(
    (list: Param[]) => Object.fromEntries(list.map((p) => [p.name, p.value])),
    []
  );

  // Run a script through the worker; on failure, ask the server to repair and
  // retry up to MAX_REPAIRS. Returns the script that actually executed.
  const executeWithRepair = useCallback(
    async (initialScript: string, values: Record<string, number>): Promise<string> => {
      let current = initialScript;
      for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
        try {
          const buf = await runJscad(current, values);
          setStl(buf);
          return current;
        } catch (err) {
          if (attempt === MAX_REPAIRS) throw err;
          setStatus(`Fixing a geometry error (attempt ${attempt + 1}/${MAX_REPAIRS})…`);
          const res = await fetch("/api/repair", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ script: current, error: (err as Error).message }),
          });
          const data = (await res.json()) as GenResponse;
          if (data.error) throw new Error(data.error);
          current = data.script!;
        }
      }
      return current;
    },
    []
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    const nextMessages = [...messages, { role: "user" as const, content: text }];
    setMessages(nextMessages);
    setStatus("Designing…");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, currentScript: script }),
      });
      const data = (await res.json()) as GenResponse;
      if (data.error) throw new Error(data.error);

      const newParams = parseParams(data.script!);
      setStatus("Building geometry…");
      const finalScript = await executeWithRepair(data.script!, paramValues(newParams));

      setScript(finalScript);
      setParams(parseParams(finalScript));
      setMessages((m) => [...m, { role: "assistant", content: data.summary! }]);
      setStatus("");
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${(err as Error).message}` }]);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }, [input, busy, messages, script, executeWithRepair, paramValues]);

  // Live slider edits: re-run locally, no API call.
  const onParam = useCallback(
    (name: string, value: number) => {
      const updated = params.map((p) => (p.name === name ? { ...p, value } : p));
      setParams(updated);
      runJscad(script, paramValues(updated)).then(setStl).catch(() => {});
    },
    [params, script, paramValues]
  );

  const download = useCallback(() => {
    if (!stl) return;
    const blob = new Blob([stl], { type: "model/stl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "chisel-model.stl";
    a.click();
    URL.revokeObjectURL(url);
  }, [stl]);

  return (
    <div className="app">
      <aside className="chat">
        <header className="brand">
          <span className="logo">◢ CHISEL</span>
          <span className="tagline">say it. shape it.</span>
        </header>

        <div className="messages" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="empty">
              <p>Describe a part and I'll model it.</p>
              <ul>
                <li onClick={() => setInput("a coffee mug, 350ml, with a rounded handle")}>
                  a coffee mug, 350ml, with a rounded handle
                </li>
                <li onClick={() => setInput("a hex phone stand angled at 60 degrees")}>
                  a hex phone stand angled at 60°
                </li>
                <li onClick={() => setInput("an M4 bolt, 20mm long, with a hex head")}>
                  an M4 bolt, 20mm long, hex head
                </li>
              </ul>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.content}
            </div>
          ))}
          {status && <div className="msg status">{status}</div>}
        </div>

        {params.length > 0 && (
          <div className="params">
            <div className="params-title">Parameters</div>
            {params.map((p) => (
              <label key={p.name} className="param">
                <span>{p.label}</span>
                <input
                  type="range"
                  min={Math.min(p.value * 0.2, 0)}
                  max={Math.max(p.value * 2.5, p.value + 10)}
                  step={Math.max(Math.abs(p.value) / 100, 0.1)}
                  value={p.value}
                  onChange={(e) => onParam(p.name, parseFloat(e.target.value))}
                />
                <b>{p.value.toFixed(1)}</b>
              </label>
            ))}
          </div>
        )}

        <div className="composer">
          <textarea
            value={input}
            placeholder={script ? "Refine it… (e.g. make the walls thinner)" : "What should I build?"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={busy}
          />
          <button onClick={send} disabled={busy || !input.trim()}>
            {busy ? "…" : "↑"}
          </button>
        </div>
      </aside>

      <main className="stage">
        <Viewer stl={stl} />
        {stl && (
          <div className="toolbar">
            <button onClick={download}>Download STL</button>
            <button
              className="ghost"
              onClick={() => navigator.clipboard.writeText(script)}
              title="Copy the JSCAD source"
            >
              Copy script
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
