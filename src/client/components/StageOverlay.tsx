import type { Stage } from "../App";

// A hard-to-miss overlay on the 3D stage while work is happening. Shows an
// animated wireframe cube, the current step, and a stepper so the user always
// knows something is happening and roughly where in the pipeline we are.
const STEPS: { key: Stage; short: string }[] = [
  { key: "thinking", short: "Design" },
  { key: "building", short: "Build" },
  { key: "checking", short: "Check" },
];

function stepIndex(stage: Stage): number {
  if (stage === "thinking") return 0;
  if (stage === "building" || stage === "fixing") return 1;
  if (stage === "checking" || stage === "refining") return 2;
  return -1;
}

export function StageOverlay({ stage, label }: { stage: Stage; label: string }) {
  if (!stage) return null;
  const active = stepIndex(stage);
  return (
    <div className="overlay">
      <div className="overlay-card">
        <div className="cube-loader" aria-hidden>
          <div className="cube">
            <span /><span /><span /><span /><span /><span />
          </div>
        </div>
        <div className="overlay-label">
          {label}
          <span className="dots"><i /><i /><i /></span>
        </div>
        <div className="stepper">
          {STEPS.map((s, i) => (
            <div key={s.key} className={`step ${i < active ? "done" : ""} ${i === active ? "on" : ""}`}>
              <span className="dot" />
              {s.short}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
