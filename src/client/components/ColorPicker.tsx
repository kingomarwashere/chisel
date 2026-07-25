// Model colour selector: a row of preset swatches + a native custom picker.
// Colour is a viewer preference (persisted in localStorage by App), not part of
// the geometry — it only sets the preview material.
const PRESETS = [
  "#FF2D55", // radical red
  "#FF7A00", // orange
  "#FFD400", // yellow
  "#3ddc84", // green
  "#4a9eff", // blue
  "#B47CFF", // purple
  "#C8CCD4", // steel
  "#F2F2F0", // white
  "#1A1A1A", // graphite
];

export function ColorPicker({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  return (
    <div className="colorpicker">
      {PRESETS.map((c) => (
        <button
          key={c}
          className={`swatch ${c.toLowerCase() === color.toLowerCase() ? "active" : ""}`}
          style={{ background: c }}
          title={c}
          onClick={() => onChange(c)}
        />
      ))}
      <label className="swatch custom" title="Custom colour">
        <input type="color" value={color} onChange={(e) => onChange(e.target.value)} />
        <span>+</span>
      </label>
    </div>
  );
}
