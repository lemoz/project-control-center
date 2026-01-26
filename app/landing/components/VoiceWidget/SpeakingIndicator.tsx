type SpeakingIndicatorProps = {
  active: boolean;
};

export function SpeakingIndicator({ active }: SpeakingIndicatorProps) {
  if (!active) return null;

  return (
    <div className="voice-speaking" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
