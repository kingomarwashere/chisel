import { useEffect, useState } from "react";

const MCP_URL = "https://chisel.theradicalparty.com/mcp";
// Cursor one-click install deep link: base64(JSON) of the server config.
const CURSOR_DEEPLINK =
  "cursor://anysphere.cursor-deeplink/mcp/install?name=chisel&config=" +
  btoa(JSON.stringify({ url: MCP_URL }));

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
          Paste an <b>Anthropic API key</b> to run Chisel on your own account (Claude Sonnet, with
          vision self-check). It's stored only in this browser and used just for your requests.
          Leave empty to use <b>free pooled compute</b> via Radical Commons — no key needed.
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
          <b>Prefer your own AI client?</b> Chisel is also an MCP server — connect it once and drive
          it with your own quota. One click:
          <div className="connect-row">
            <a className="connect-btn cursor" href={CURSOR_DEEPLINK} title="Add Chisel to Cursor">
              Add to Cursor
            </a>
            <button
              className="connect-btn claude"
              title="Copies the URL and opens Claude connectors — just paste"
              onClick={(e) => {
                navigator.clipboard.writeText(MCP_URL);
                window.open("https://claude.ai/settings/connectors", "_blank", "noreferrer");
                const el = e.currentTarget;
                el.dataset.copied = "1";
                setTimeout(() => delete el.dataset.copied, 1400);
              }}
            >
              Add to Claude
            </button>
            <button
              className="copy-url"
              title="Copy MCP URL"
              onClick={(e) => {
                navigator.clipboard.writeText(MCP_URL);
                const el = e.currentTarget;
                el.dataset.copied = "1";
                setTimeout(() => delete el.dataset.copied, 1200);
              }}
            >
              <span className="copy-hint">{"⧉ Copy URL"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
