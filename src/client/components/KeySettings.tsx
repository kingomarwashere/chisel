import { useEffect, useState } from "react";

// BYOK: let a user supply their own Anthropic key. It's stored only in this
// browser (localStorage) and sent to Chisel's worker as x-user-key, which
// forwards it to Anthropic — so their usage bills their account, not ours.
export function KeySettings({
  open,
  value,
  onSave,
  onClose,
}: {
  open: boolean;
  value: string;
  onSave: (key: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);
  if (!open) return null;

  const save = () => {
    onSave(draft.trim());
    onClose();
  };
  const clear = () => {
    setDraft("");
    onSave("");
    onClose();
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          Use your own AI key
          <button onClick={onClose}>✕</button>
        </div>
        <p className="modal-note">
          Paste an <b>Anthropic API key</b> to run Chisel on your own account. It's stored only in
          this browser and used just for your requests. Leave empty to use the shared key.
        </p>
        <input
          className="key-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <div className="modal-actions">
          {value && (
            <button className="ghost" onClick={clear}>
              Remove
            </button>
          )}
          <a
            className="modal-link"
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noreferrer"
          >
            Get a key ↗
          </a>
          <button onClick={save} disabled={!!draft && !draft.trim().startsWith("sk-ant-")}>
            Save
          </button>
        </div>
        <div className="modal-foot">
          <b>Prefer your own AI client?</b> Chisel is also an MCP server — connect Claude Desktop,
          Claude.ai, or Cursor and drive it with your own quota:
          <button
            className="copy-url"
            title="Copy MCP URL"
            onClick={(e) => {
              navigator.clipboard.writeText("https://chisel.theradicalparty.com/mcp");
              const el = e.currentTarget;
              el.dataset.copied = "1";
              setTimeout(() => delete el.dataset.copied, 1200);
            }}
          >
            <span className="mono">chisel.theradicalparty.com/mcp</span>
            <span className="copy-hint">{"⧉"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
