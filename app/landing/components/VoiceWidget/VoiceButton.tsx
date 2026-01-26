import type { ButtonHTMLAttributes } from "react";

type VoiceButtonState = "idle" | "connecting" | "listening" | "speaking" | "error";

type VoiceButtonProps = {
  state: VoiceButtonState;
  label: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function VoiceButton({ state, label, className, ...props }: VoiceButtonProps) {
  const classes = ["voice-button", `voice-button--${state}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      aria-label={label}
      aria-pressed={state !== "idle"}
      {...props}
    >
      <span className="voice-button-ring" aria-hidden="true" />
      {state === "connecting" ? (
        <span className="spinner" aria-hidden="true" />
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 1 1-6 0V6a3 3 0 0 1 3-3Z" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v3" />
        </svg>
      )}
    </button>
  );
}
