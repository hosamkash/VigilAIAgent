import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";

const ICONS = {
  left: ChevronLeft,
  right: ChevronRight,
  up: ChevronUp,
  down: ChevronDown,
} as const;

/** Same colored control everywhere a pane can collapse or expand. */
export function PaneToggleButton({
  direction,
  label,
  onClick,
}: {
  direction: keyof typeof ICONS;
  label: string;
  onClick: () => void;
}) {
  const Icon = ICONS[direction];
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="vigil-pane-toggle"
    >
      <Icon className="h-4 w-4" strokeWidth={2.75} aria-hidden />
    </button>
  );
}
