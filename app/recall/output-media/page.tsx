"use client";

import { useConversation } from "@elevenlabs/react";
import { useEffect, useMemo, useRef, useState } from "react";

type TranscriptEntry = {
  id: string;
  role: "user" | "agent";
  message: string;
  timestamp: string;
};

type ConversationMessage = {
  role: "user" | "agent";
  message: string;
};

const MAX_TRANSCRIPT_ENTRIES = 8;
const MAX_LATENCY_SAMPLES = 12;
const SYSTEM_MESSAGE_PREFIX = "[system]";
const TELEMETRY_ENDPOINT = "/api/recall/telemetry";
const TELEMETRY_TOKEN = process.env.NEXT_PUBLIC_RECALL_TELEMETRY_TOKEN;
const GREETING_PROMPT =
  "Please greet the meeting and let participants know you're ready to help.";

function formatTimestamp(value: Date): string {
  return value.toLocaleTimeString();
}

function formatLatency(value: number | null): string {
  if (value === null) return "--";
  return `${Math.round(value)} ms`;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Voice connection failed.";
}

function sendTelemetry(payload: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const record = { sent_at: new Date().toISOString(), ...payload };
  const body = JSON.stringify(record);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const telemetryUrl = TELEMETRY_TOKEN
    ? `${TELEMETRY_ENDPOINT}?token=${encodeURIComponent(TELEMETRY_TOKEN)}`
    : TELEMETRY_ENDPOINT;
  if (TELEMETRY_TOKEN) {
    headers["x-recall-telemetry-token"] = TELEMETRY_TOKEN;
  }

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon(telemetryUrl, blob);
  } else {
    void fetch(telemetryUrl, {
      method: "POST",
      headers,
      body,
      keepalive: true,
    });
  }
}

export default function RecallOutputMediaPage() {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [audioLatencies, setAudioLatencies] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const lastUserAtRef = useRef<number | null>(null);
  const lastIsSpeakingRef = useRef(false);
  const greetedRef = useRef(false);
  const startedRef = useRef(false);
  const serverLocation = process.env.NEXT_PUBLIC_ELEVENLABS_SERVER_LOCATION;

  const conversation = useConversation({
    serverLocation,
    onConnect: () => {
      setError(null);
      sendTelemetry({ type: "connected" });
    },
    onMessage: (message: ConversationMessage) => {
      if (!message?.message) return;
      if (message.message.trim().toLowerCase().startsWith(SYSTEM_MESSAGE_PREFIX)) {
        return;
      }
      const role = message.role === "user" || message.role === "agent" ? message.role : "agent";
      const now = Date.now();
      if (role === "user") {
        lastUserAtRef.current = now;
      }
      const entry: TranscriptEntry = {
        id: `${now}-${Math.random().toString(16).slice(2)}`,
        role,
        message: message.message,
        timestamp: formatTimestamp(new Date()),
      };
      const trimmed = message.message.trim();
      sendTelemetry({
        type: "message",
        role,
        message_preview: trimmed.slice(0, 160),
        message_length: trimmed.length,
      });
      setTranscript((prev) => {
        const next = [...prev, entry];
        return next.slice(-MAX_TRANSCRIPT_ENTRIES);
      });
    },
    onError: (message) => {
      const errorMessage = typeof message === "string" ? message : "Voice agent error.";
      setError(errorMessage);
      sendTelemetry({ type: "error", message: errorMessage });
    },
  });

  type ConversationAliases = typeof conversation & {
    startConversation?: typeof conversation.startSession;
    endConversation?: typeof conversation.endSession;
    sendMessage?: (text: string) => void;
    sendUserMessage?: (text: string) => void;
  };

  const conversationControls = conversation as ConversationAliases;

  useEffect(() => {
    if (conversation.status !== "connected") {
      greetedRef.current = false;
      lastUserAtRef.current = null;
      lastIsSpeakingRef.current = false;
      return;
    }
    if (greetedRef.current) return;
    const sendMessage =
      conversationControls.sendMessage ?? conversationControls.sendUserMessage;
    if (!sendMessage) {
      const errorMessage = "Text messaging is not supported by this SDK version.";
      setError(errorMessage);
      sendTelemetry({ type: "error", message: errorMessage });
      return;
    }
    greetedRef.current = true;
    sendMessage(GREETING_PROMPT);
  }, [conversation.status, conversationControls]);

  useEffect(() => {
    const wasSpeaking = lastIsSpeakingRef.current;
    const isSpeaking = conversation.isSpeaking;
    if (isSpeaking && !wasSpeaking && lastUserAtRef.current) {
      const delta = Date.now() - lastUserAtRef.current;
      lastUserAtRef.current = null;
      setAudioLatencies((prev) => {
        const next = [...prev, delta];
        return next.slice(-MAX_LATENCY_SAMPLES);
      });
      sendTelemetry({ type: "audio_latency", latency_ms: delta });
    }
    lastIsSpeakingRef.current = isSpeaking;
  }, [conversation.isSpeaking]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let active = true;

    const start = async () => {
      try {
        const res = await fetch("/api/voice/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? "Failed to start voice session.");
        }
        const payload = (await res.json()) as {
          signedUrl?: string;
          signed_url?: string;
        };
        const signedUrl = payload?.signedUrl ?? payload?.signed_url;
        if (!signedUrl) {
          throw new Error("Signed URL missing from voice session response.");
        }
        const startConversation =
          conversationControls.startConversation ?? conversationControls.startSession;
        if (!startConversation) {
          throw new Error("Conversation start is not supported by this SDK version.");
        }
        const id = await startConversation({
          signedUrl,
          connectionType: "websocket",
        });
        if (active) {
          const sessionId = typeof id === "string" ? id : null;
          setSessionId(sessionId);
          sendTelemetry({ type: "session_started", session_id: sessionId });
        }
      } catch (err) {
        if (active) setError(normalizeErrorMessage(err));
      }
    };

    void start();

    return () => {
      active = false;
      const endConversation =
        conversationControls.endConversation ?? conversationControls.endSession;
      if (endConversation) {
        void endConversation();
      }
    };
  }, [conversationControls]);

  const statusLabel = useMemo(() => {
    if (conversation.status === "connected") return "Connected";
    if (conversation.status === "connecting") return "Connecting";
    return "Disconnected";
  }, [conversation.status]);

  const lastLatency = audioLatencies.length ? audioLatencies[audioLatencies.length - 1] : null;
  const averageLatency = useMemo(() => average(audioLatencies), [audioLatencies]);

  return (
    <>
      <style jsx global>{`
        html,
        body {
          background: radial-gradient(circle at top, #1b2747 0%, #0b0f1a 55%, #05070c 100%);
          color: #eef2ff;
        }

        .nav-bar,
        .chat-widget {
          display: none !important;
        }

        .container {
          max-width: none;
          padding: 0;
        }
      `}</style>
      <div className="recall-output">
        <div className="recall-hero">
          <div className="recall-title">
            <span className="recall-title-eyebrow">Recall.ai Output Media</span>
            <h1>PCC Voice Agent</h1>
            <p>ElevenLabs Conversation API - live meeting bridge</p>
          </div>
          <div className="recall-orb">
            <div className={conversation.isSpeaking ? "orb-core speaking" : "orb-core"} />
            <div className="orb-ring" />
            <div className="orb-ring ring-delay" />
          </div>
        </div>

        <div className="recall-status-row">
          <div className={`status-pill status-${conversation.status}`}>
            {statusLabel}
          </div>
          <div className="status-meta">
            Session {sessionId ? sessionId.slice(0, 8) : "--"}
          </div>
          <div className="status-meta">
            Speaking {conversation.isSpeaking ? "yes" : "no"}
          </div>
        </div>

        <div className="recall-metrics">
          <div>
            <span className="metric-label">Last transcript-&gt;TTS start</span>
            <span className="metric-value">{formatLatency(lastLatency)}</span>
          </div>
          <div>
            <span className="metric-label">Avg transcript-&gt;TTS start</span>
            <span className="metric-value">{formatLatency(averageLatency)}</span>
          </div>
          <div>
            <span className="metric-label">Samples</span>
            <span className="metric-value">{audioLatencies.length || "--"}</span>
          </div>
        </div>

        <div className="recall-transcript">
          <div className="transcript-header">Live transcript</div>
          {error && <div className="transcript-error">{error}</div>}
          {!transcript.length && !error && (
            <div className="transcript-empty">Waiting for speech...</div>
          )}
          {transcript.map((entry) => (
            <div key={entry.id} className={`transcript-line ${entry.role}`}>
              <span className="transcript-time">{entry.timestamp}</span>
              <span className="transcript-role">{entry.role}</span>
              <span className="transcript-message">{entry.message}</span>
            </div>
          ))}
        </div>
      </div>
      <style jsx>{`
        .recall-output {
          min-height: 100vh;
          padding: 48px 64px 64px;
          display: flex;
          flex-direction: column;
          gap: 28px;
          font-family: "Space Grotesk", "Avenir Next", "Futura", sans-serif;
          letter-spacing: 0.01em;
        }

        .recall-hero {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 32px;
          flex-wrap: wrap;
        }

        .recall-title h1 {
          margin: 8px 0 6px;
          font-size: clamp(2.4rem, 4vw, 3.6rem);
          font-weight: 600;
        }

        .recall-title p {
          margin: 0;
          color: rgba(238, 242, 255, 0.72);
          font-size: 0.95rem;
        }

        .recall-title-eyebrow {
          text-transform: uppercase;
          font-size: 0.72rem;
          letter-spacing: 0.18em;
          color: rgba(144, 188, 255, 0.9);
        }

        .recall-orb {
          position: relative;
          width: 160px;
          height: 160px;
        }

        .orb-core {
          position: absolute;
          inset: 24px;
          border-radius: 50%;
          background: radial-gradient(circle at 30% 30%, #7dd3fc, #2563eb 55%, #1e1b4b 100%);
          box-shadow: 0 0 30px rgba(125, 211, 252, 0.5);
          transition: transform 0.3s ease;
        }

        .orb-core.speaking {
          transform: scale(1.08);
        }

        .orb-ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 1px solid rgba(125, 211, 252, 0.4);
          animation: pulse 3s infinite ease-in-out;
        }

        .ring-delay {
          animation-delay: 1.5s;
        }

        .recall-status-row {
          display: flex;
          gap: 16px;
          align-items: center;
          flex-wrap: wrap;
        }

        .status-pill {
          padding: 6px 14px;
          border-radius: 999px;
          font-size: 0.85rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(148, 163, 184, 0.4);
        }

        .status-connected {
          border-color: rgba(45, 212, 191, 0.7);
          color: #5eead4;
        }

        .status-connecting {
          border-color: rgba(251, 191, 36, 0.7);
          color: #fde68a;
        }

        .status-disconnected {
          border-color: rgba(248, 113, 113, 0.7);
          color: #fecaca;
        }

        .status-meta {
          font-size: 0.82rem;
          color: rgba(226, 232, 240, 0.7);
        }

        .recall-metrics {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 16px;
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 18px;
          padding: 16px 20px;
          backdrop-filter: blur(6px);
        }

        .metric-label {
          display: block;
          font-size: 0.72rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgba(148, 163, 184, 0.8);
        }

        .metric-value {
          font-size: 1.2rem;
          font-weight: 600;
          color: #e2e8f0;
        }

        .recall-transcript {
          background: rgba(8, 13, 24, 0.7);
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 18px;
          padding: 18px 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-height: 220px;
        }

        .transcript-header {
          font-size: 0.8rem;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: rgba(148, 163, 184, 0.8);
        }

        .transcript-error {
          background: rgba(127, 29, 29, 0.4);
          border: 1px solid rgba(248, 113, 113, 0.5);
          color: #fecaca;
          padding: 8px 10px;
          border-radius: 10px;
          font-size: 0.85rem;
        }

        .transcript-empty {
          color: rgba(148, 163, 184, 0.8);
          font-size: 0.9rem;
        }

        .transcript-line {
          display: grid;
          grid-template-columns: 70px 60px 1fr;
          gap: 12px;
          font-size: 0.9rem;
          line-height: 1.4;
          color: rgba(226, 232, 240, 0.9);
        }

        .transcript-line.agent .transcript-role {
          color: #7dd3fc;
        }

        .transcript-line.user .transcript-role {
          color: #fcd34d;
        }

        .transcript-time {
          color: rgba(148, 163, 184, 0.8);
          font-variant-numeric: tabular-nums;
        }

        .transcript-role {
          text-transform: uppercase;
          font-size: 0.7rem;
          letter-spacing: 0.12em;
          margin-top: 2px;
        }

        .transcript-message {
          color: rgba(226, 232, 240, 0.9);
        }

        @media (max-width: 900px) {
          .recall-output {
            padding: 32px 24px 48px;
          }

          .recall-hero {
            flex-direction: column;
            align-items: flex-start;
          }

          .recall-orb {
            width: 140px;
            height: 140px;
          }

          .transcript-line {
            grid-template-columns: 1fr;
          }

          .transcript-time,
          .transcript-role {
            font-size: 0.7rem;
          }
        }

        @keyframes pulse {
          0% {
            transform: scale(0.95);
            opacity: 0.4;
          }
          70% {
            transform: scale(1.06);
            opacity: 0.8;
          }
          100% {
            transform: scale(0.95);
            opacity: 0.4;
          }
        }
      `}</style>
    </>
  );
}
