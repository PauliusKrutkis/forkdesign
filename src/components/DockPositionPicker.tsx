import type { OverlayPosition } from "./settings";

const POSITIONS: {
  id: OverlayPosition;
  label: string;
}[] = [
  { id: "top-left", label: "Top left" },
  { id: "top-right", label: "Top right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "bottom-right", label: "Bottom right" },
];

interface Props {
  onChange: (v: OverlayPosition) => void;
  value: OverlayPosition;
}

export function DockPositionPicker({ value, onChange }: Props) {
  return (
    <select
      aria-label="Dock position"
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onChange={(e) => onChange(e.target.value as OverlayPosition)}
      value={value}
    >
      {POSITIONS.map((pos) => (
        <option key={pos.id} value={pos.id}>
          {pos.label}
        </option>
      ))}
    </select>
  );
}
