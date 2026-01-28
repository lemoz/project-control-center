"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversation, type Status } from "@elevenlabs/react";
import {
  createVoiceClientTools,
  useCanvasVoiceState,
  type CanvasVoiceSession,
} from "./voiceClientTools";

type TranscriptEntry = {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: string;
};

type ConversationMessage = {
  role: "user" | "agent";
  message: string;
};

type StartOptions = {
  textOnly?: boolean;
};

const TRANSCRIPT_LIMIT = 12;
const SYSTEM_MESSAGE_PREFIX = "[system]";

function formatTimestamp(value: Date): string {
  return value.toLocaleTimeString();
}

function buildSessionGreeting(session: CanvasVoiceSession): string {
  if (session.status === "onboarding") {
    return "Welcome to Project Control Center. You're onboarding the global session. Ask me to continue setup or review the briefing.";
  }
  if (session.status === "autonomous") {
    return "Welcome back. The global session is running autonomously. Ask what's happening for the latest update or tell me what to focus on.";
  }
  if (session.status === "paused") {
    return "Welcome back. The global session is paused. Ask what's happening for context or tell me to resume and reprioritize.";
  }
  return "Welcome back. There's no active global session yet. Ask me to start onboarding or review the portfolio.";
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Voice connection failed.";
}

function shouldTreatAsPermissionError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "NotAllowedError" || error.name === "PermissionDeniedError";
  }
  if (error instanceof Error) {
    return error.message.toLowerCase().includes("permission");
  }
  return false;
}

export function useVoiceAgent() {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [starting, setStarting] = useState(false);
  const clientTools = useMemo(() => createVoiceClientTools(), []);
  const serverLocation = process.env.NEXT_PUBLIC_ELEVENLABS_SERVER_LOCATION;
  const canvasState = useCanvasVoiceState();
  const greetingSentRef = useRef(false);

  const conversation = useConversation({
    clientTools,
    serverLocation,
    onConnect: () => {
      setError(null);
    },
    onDisconnect: () => {
      setStarting(false);
    },
    onMessage: (message: ConversationMessage) => {
      setTranscript((prev) => {
        if (
          message.role === "user" &&
          message.message.trim().toLowerCase().startsWith(SYSTEM_MESSAGE_PREFIX)
        ) {
          return prev;
        }
        const nextEntry: TranscriptEntry = {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          role: message.role,
          text: message.message,
          timestamp: formatTimestamp(new Date()),
        };
        const updated = [...prev, nextEntry];
        return updated.slice(-TRANSCRIPT_LIMIT);
      });
    },
    onError: (message) => {
      setError(typeof message === "string" ? message : "Voice agent error.");
    },
  });

  type ConversationAliases = typeof conversation & {
    startConversation?: typeof conversation.startSession;
    endConversation?: typeof conversation.endSession;
    sendMessage?: (text: string) => void;
    sendUserMessage?: (text: string) => void;
  };

  const conversationControls = conversation as ConversationAliases;
  const status: Status = conversation.status;
  const isSpeaking = conversation.isSpeaking;

  const ensureMicrophoneAccess = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionDenied(true);
      setError("Microphone access is not supported in this browser.");
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (err) {
      if (shouldTreatAsPermissionError(err)) {
        setPermissionDenied(true);
        setError("Microphone permission denied. Use text-only mode instead.");
      } else {
        setError(normalizeErrorMessage(err));
      }
      return false;
    }
  }, []);

  const start = useCallback(
    async (options: StartOptions = {}): Promise<boolean> => {
      setError(null);
      setStarting(true);

      if (!options.textOnly) {
        const ready = await ensureMicrophoneAccess();
        if (!ready) {
          setStarting(false);
          return false;
        }
      }

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
        await startConversation({
          signedUrl,
          connectionType: "websocket",
          textOnly: options.textOnly,
        });
        setStarting(false);
        return true;
      } catch (err) {
        setError(normalizeErrorMessage(err));
        setStarting(false);
        return false;
      }
    },
    [conversationControls, ensureMicrophoneAccess]
  );

  const stop = useCallback(async () => {
    setStarting(false);
    const endConversation = conversationControls.endConversation ?? conversationControls.endSession;
    await endConversation();
  }, [conversationControls]);

  const sendContextualUpdate = useCallback(
    (text: string) => {
      conversation.sendContextualUpdate(text);
    },
    [conversation]
  );

  const sendTextMessage = useCallback(
    async (text: string, options: StartOptions = { textOnly: true }) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      if (status !== "connected") {
        const started = await start({ textOnly: options.textOnly ?? true });
        if (!started) return false;
      }
      const sendMessage =
        conversationControls.sendMessage ?? conversationControls.sendUserMessage;
      if (!sendMessage) {
        setError("Text messaging is not supported by this SDK version.");
        return false;
      }
      sendMessage(trimmed);
      return true;
    },
    [conversationControls, start, status]
  );

  const sendSystemMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      return sendTextMessage(`${SYSTEM_MESSAGE_PREFIX} ${trimmed}`, { textOnly: true });
    },
    [sendTextMessage]
  );

  useEffect(() => {
    if (status !== "connected") {
      greetingSentRef.current = false;
      return;
    }
    if (greetingSentRef.current) return;
    const greeting = buildSessionGreeting(canvasState.session);
    greetingSentRef.current = true;
    void sendSystemMessage(greeting);
  }, [canvasState.session, sendSystemMessage, status]);

  return {
    status,
    isSpeaking,
    isConnecting: starting || status === "connecting",
    transcript,
    error,
    permissionDenied,
    start,
    stop,
    sendTextMessage,
    sendSystemMessage,
    sendContextualUpdate,
  };
}

export type { TranscriptEntry };
