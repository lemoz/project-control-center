"use client";

import { useEffect, useRef } from "react";

type SpeakingIndicatorProps = {
  active: boolean;
  hidden?: boolean;
  getOutputByteFrequencyData?: () => Uint8Array | undefined;
};

const BAR_COUNT = 24;
const BAR_GAP = 2;
const SMOOTHING = 0.3;
const AMPLIFY = 1.35;

export function SpeakingIndicator({
  active,
  hidden = false,
  getOutputByteFrequencyData,
}: SpeakingIndicatorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(active);
  const dataRef = useRef(getOutputByteFrequencyData);
  const barsRef = useRef<number[]>(Array.from({ length: BAR_COUNT }, () => 0));

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    dataRef.current = getOutputByteFrequencyData;
  }, [getOutputByteFrequencyData]);

  useEffect(() => {
    if (hidden) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let frameId = 0;
    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) {
        frameId = requestAnimationFrame(draw);
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const nextWidth = Math.round(width * dpr);
      const nextHeight = Math.round(height * dpr);
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const centerY = height / 2;
      context.strokeStyle = "rgba(148, 160, 187, 0.45)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, centerY);
      context.lineTo(width, centerY);
      context.stroke();

      const totalGap = BAR_GAP * (BAR_COUNT - 1);
      const barWidth = Math.max(1, (width - totalGap) / BAR_COUNT);
      const maxBarHeight = height * 0.9;
      const activeNow = activeRef.current;
      const audioData = activeNow ? dataRef.current?.() : undefined;
      const binSize = audioData
        ? Math.max(1, Math.floor(audioData.length / BAR_COUNT))
        : 0;

      context.fillStyle = "#59c6ff";
      for (let i = 0; i < BAR_COUNT; i += 1) {
        let target = 0;
        if (audioData && audioData.length) {
          const start = i * binSize;
          const end = Math.min(audioData.length, start + binSize);
          let sum = 0;
          for (let j = start; j < end; j += 1) {
            sum += audioData[j];
          }
          const average = sum / Math.max(1, end - start);
          target = Math.min(1, (average / 255) * AMPLIFY);
        }
        if (!activeNow) target = 0;

        const previous = barsRef.current[i] ?? 0;
        const next = previous + (target - previous) * SMOOTHING;
        barsRef.current[i] = next;

        if (!activeNow) continue;
        const barHeight = Math.max(1, next * maxBarHeight);
        const x = i * (barWidth + BAR_GAP);
        const y = centerY - barHeight / 2;
        context.fillRect(x, y, barWidth, barHeight);
      }

      frameId = requestAnimationFrame(draw);
    };

    frameId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [hidden]);

  if (hidden) return null;

  return <canvas ref={canvasRef} className="voice-waveform" aria-hidden="true" />;
}
