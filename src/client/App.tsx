import { useCallback, useEffect, useRef, useState } from "react";
import { Viewer } from "./components/Viewer";
import { StageOverlay } from "./components/StageOverlay";
import { DesignsDrawer } from "./components/DesignsDrawer";
import { ColorPicker } from "./components/ColorPicker";
import { runJscad, parseParams, type Param } from "./engine";

interface Msg {
  role: "user" | "assistant";
  content: string;
}
interface GenResponse {
  script?: string;
  summary?: string;
  error?: string;
}
interface DesignSummary {
  id: string;
  title: string;
  updated_at: number;
}

export type Stage = "" | "thinking" | "building" | "fixing" | "checking" | "refining";
const STAGE_LABEL: Record<Stage, string> = {
  "": "",
  thinking: "Designing your part",
  building: "Building geometry",
  fixing: "Fixing geometry",
  checking: "Checking the result",
  refining: "Refining the details",
};

const MAX_REPAIRS = 3;

export default function App() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [script, setScript] = useState("");
  const [params, setParams] = useState<Param[]>([]);
  const [stl, setStl] = useState<ArrayBuffer | null>(null);
  const [stage, setStage] = useState<Stage>("");
  const [busy, setBusy] = useState(false);
  const [designVersion, setDesignVersion] = useState(0); // bumps only on new geometry / fit / load
  const [designId, setDesignId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [designs, setDesigns] = useState<DesignSummary[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [steppy, setSteppy] = useState(false); // STEP export in flight
  const [color, setColor] = useState<string>(() => {
    try {
      return localStorage.getItem("chisel_color") || "#FF2D55";
    } catch {
      return "#FF2D55";
    }
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<(() => string | null) | null>(null);
  const designIdRef = useRef<string | null>(null);
  designIdRef.current = designId;

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, stage]);

  const refreshDesigns = useCallback(async () => {
    try {
      const r = await fetch("/api/designs");
      const d = (await r.json()) as { designs: DesignSummary[] };
      setDesigns(d.designs ?? []);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    refreshDesigns();
  }, [refreshDesigns]);

  const paramValues = useCallback(
    (list: Param[]) => Object.fromEntries(list.map((p) => [p.name, p.value])),
    []
  );

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
          setStage("fixing");
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

  const capture = useCallback(async (): Promise<string | null> => {
    // Give the renderer a couple of frames to draw + the camera to settle.
    await new Promise((r) => setTimeout(r, 450));
    return captureRef.current?.() ?? null;
  }, []);

  const autosave = useCallback(
    async (msgs: Msg[], scr: string, ttl: string) => {
      try {
        const r = await fetch("/api/designs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: designIdRef.current, title: ttl, script: scr, messages: msgs }),
        });
        const d = (await r.json()) as { id: string };
        setDesignId(d.id);
        refreshDesigns();
      } catch {
        /* ignore */
      }
    },
    [refreshDesigns]
  );

  // One generate → build → (repair) → verify → (refine) cycle.
  const runTurn = useCallback(
    async (convo: Msg[], priorScript: string, originalRequest: string) => {
      setStage("thinking");
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: convo, currentScript: priorScript }),
      });
      const data = (await res.json()) as GenResponse;
      if (data.error) throw new Error(data.error);

      setStage("building");
      const params0 = parseParams(data.script!);
      let finalScript = await executeWithRepair(data.script!, paramValues(params0));

      setScript(finalScript);
      setParams(parseParams(finalScript));
      setDesignVersion((v) => v + 1); // new geometry → refit camera once
      setMessages((m) => [...m, { role: "assistant", content: data.summary! }]);

      // --- Vision verify (B) ---
      setStage("checking");
      const img = await capture();
      if (img) {
        try {
          const vr = await fetch("/api/verify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ request: originalRequest, image: img }),
          });
          const verdict = (await vr.json()) as { matches: boolean; critique: string };
          if (!verdict.matches && verdict.critique) {
            setStage("refining");
            setMessages((m) => [...m, { role: "assistant", content: `Refining: ${verdict.critique}` }]);
            const refineRes = await fetch("/api/generate", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                messages: [{ role: "user", content: verdict.critique }],
                currentScript: finalScript,
              }),
            });
            const rd = (await refineRes.json()) as GenResponse;
            if (!rd.error && rd.script) {
              const rp = parseParams(rd.script);
              finalScript = await executeWithRepair(rd.script, paramValues(rp));
              setScript(finalScript);
              setParams(parseParams(finalScript));
              setDesignVersion((v) => v + 1);
            }
          }
        } catch {
          /* verify is best-effort */
        }
      }
      return finalScript;
    },
    [executeWithRepair, paramValues, capture]
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    const nextMessages = [...messages, { role: "user" as const, content: text }];
    setMessages(nextMessages);
    const ttl = title || text.slice(0, 60);
    if (!title) setTitle(ttl);

    try {
      const finalScript = await runTurn(nextMessages, script, text);
      setStage("");
      // autosave with the freshest assistant messages
      setMessages((m) => {
        autosave(m, finalScript, ttl);
        return m;
      });
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${(err as Error).message}` }]);
      setStage("");
    } finally {
      setBusy(false);
    }
  }, [input, busy, messages, title, script, runTurn, autosave]);

  const onParam = useCallback(
    (name: string, value: number) => {
      const updated = params.map((p) => (p.name === name ? { ...p, value } : p));
      setParams(updated);
      runJscad(script, paramValues(updated)).then(setStl).catch(() => {});
    },
    [params, script, paramValues]
  );

  const newDesign = useCallback(() => {
    setMessages([]);
    setScript("");
    setParams([]);
    setStl(null);
    setDesignId(null);
    setTitle("");
    setDrawerOpen(false);
  }, []);

  const loadDesign = useCallback(
    async (id: string) => {
      setDrawerOpen(false);
      setBusy(true);
      setStage("building");
      try {
        const r = await fetch(`/api/designs/${id}`);
        const d = (await r.json()) as { title: string; script: string; messages: Msg[] };
        setMessages(d.messages ?? []);
        setTitle(d.title);
        const p = parseParams(d.script);
        setParams(p);
        setScript(d.script);
        setDesignId(id);
        await runJscad(d.script, paramValues(p)).then(setStl);
        setDesignVersion((v) => v + 1);
      } catch (err) {
        setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${(err as Error).message}` }]);
      } finally {
        setStage("");
        setBusy(false);
      }
    },
    [paramValues]
  );

  const download = useCallback(() => {
    if (!stl) return;
    const blob = new Blob([stl], { type: "model/stl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title || "chisel-model").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.stl`;
    a.click();
    URL.revokeObjectURL(url);
  }, [stl, title]);

  // STEP export (D) — re-authors the design in build123d for a true B-rep file.
  const downloadStep = useCallback(async () => {
    if (steppy) return;
    setSteppy(true);
    try {
      const brief = messages.filter((m) => m.role === "user").map((m) => m.content).join(". ");
      const res = await fetch("/api/step", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: brief || title }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        alert(e.error || `STEP export failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(title || "chisel-model").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.step`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setSteppy(false);
    }
  }, [steppy, messages, title]);

  const setModelColor = useCallback((c: string) => {
    setColor(c);
    try {
      localStorage.setItem("chisel_color", c);
    } catch {
      /* ignore */
    }
  }, []);

  const fitKey = String(designVersion);

  return (
    <div className="app">
      <aside className="chat">
        <header className="brand">
          <button className="menu" onClick={() => setDrawerOpen((o) => !o)} title="Your designs">
            ☰
          </button>
          <span className="logo">◢ CHISEL</span>
          <button className="menu new" onClick={newDesign} title="New design">
            ＋
          </button>
        </header>

        <DesignsDrawer
          open={drawerOpen}
          designs={designs}
          activeId={designId}
          onSelect={loadDesign}
          onClose={() => setDrawerOpen(false)}
        />

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
          {stage && (
            <div className="msg assistant thinking">
              <span className="dots"><i /><i /><i /></span>
              {STAGE_LABEL[stage]}
            </div>
          )}
        </div>

        {params.length > 0 && (
          <div className="params">
            <div className="params-title">Parameters · drag to reshape</div>
            {params.map((p) => {
              const min = p.value > 0 ? Math.max(p.value * 0.25, 0.5) : p.value * 2;
              const max = p.value > 0 ? p.value * 2.5 + 5 : Math.max(p.value * 0.25, 5);
              const step = Math.max(Math.abs(p.value) / 100, 0.1);
              return (
                <label key={p.name} className="param">
                  <span title={p.label}>{p.label}</span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={p.value}
                    disabled={busy}
                    onChange={(e) => onParam(p.name, parseFloat(e.target.value))}
                  />
                  <b>{p.value.toFixed(1)}</b>
                </label>
              );
            })}
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
            {busy ? <span className="spin" /> : "↑"}
          </button>
        </div>
      </aside>

      <main className="stage">
        <Viewer stl={stl} fitKey={fitKey} color={color} captureRef={captureRef} />
        <StageOverlay stage={stage} label={STAGE_LABEL[stage]} />
        {title && <div className="title-chip">{title}</div>}
        {stl && !stage && <ColorPicker color={color} onChange={setModelColor} />}
        {stl && !stage && (
          <div className="toolbar">
            <button onClick={() => setDesignVersion((v) => v + 1)} className="ghost" title="Fit to view">
              ⤢ Fit
            </button>
            <button onClick={download}>Download STL</button>
            <button onClick={downloadStep} disabled={steppy} title="True B-rep for Fusion/SolidWorks/FreeCAD">
              {steppy ? "Building STEP…" : "Download STEP"}
            </button>
            <button className="ghost" onClick={() => navigator.clipboard.writeText(script)} title="Copy the JSCAD source">
              Copy script
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
