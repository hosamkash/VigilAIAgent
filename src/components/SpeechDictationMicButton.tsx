/**
 * Mic button — same visual as VigilHub support-ticket / search dictation
 * (rose pulse while listening).
 */

import { Mic } from "lucide-react";
import { cn } from "../lib/cn";

type SpeechDictationMicButtonProps = {
  active: boolean;
  onClick: () => void;
  className?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  title?: string;
  vivid?: boolean;
};

export function SpeechDictationMicButton({
  active,
  onClick,
  className,
  size = "md",
  disabled,
  title,
  vivid = false,
}: SpeechDictationMicButtonProps) {
  const dim = size === "sm" ? "h-7 w-7" : "h-8 w-8";
  const icon = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const label = title ?? (active ? "Stop dictation" : "Start dictation");

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full border shadow-sm transition-colors disabled:opacity-50",
        dim,
        active
          ? "border-rose-600 bg-rose-600 !text-white shadow-rose-400 hover:border-rose-700 hover:!text-white"
          : vivid
            ? "border-amber-500 bg-amber-500 !text-white hover:border-amber-600 hover:bg-amber-600 hover:!text-white"
            : "border-[var(--vigil-border)] bg-[var(--vigil-panel)] text-[var(--vigil-muted)] hover:border-orange-300 hover:text-orange-700",
        className,
      )}
    >
      {active ? (
        <>
          <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-rose-500/40" />
          <Mic className={cn("relative animate-pulse", icon)} />
        </>
      ) : (
        <Mic className={icon} />
      )}
    </button>
  );
}

export default SpeechDictationMicButton;
