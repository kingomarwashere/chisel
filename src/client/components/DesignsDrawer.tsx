interface DesignSummary {
  id: string;
  title: string;
  updated_at: number;
}

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function DesignsDrawer({
  open,
  designs,
  activeId,
  onSelect,
  onClose,
}: {
  open: boolean;
  designs: DesignSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="drawer">
      <div className="drawer-head">
        Your designs
        <button onClick={onClose}>✕</button>
      </div>
      {designs.length === 0 && <div className="drawer-empty">No saved designs yet.</div>}
      <div className="drawer-list">
        {designs.map((d) => (
          <button
            key={d.id}
            className={`drawer-item ${d.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(d.id)}
          >
            <span className="di-title">{d.title || "Untitled"}</span>
            <span className="di-time">{ago(d.updated_at)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
