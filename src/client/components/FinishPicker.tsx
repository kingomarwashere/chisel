import { FINISH_OPTIONS, type Finish } from "./Viewer";

// Material-finish pills. Sits with the colour picker in the appearance cluster.
export function FinishPicker({ finish, onChange }: { finish: Finish; onChange: (f: Finish) => void }) {
  return (
    <div className="finishpicker">
      {FINISH_OPTIONS.map((o) => (
        <button
          key={o.key}
          className={`finish ${o.key === finish ? "active" : ""}`}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
