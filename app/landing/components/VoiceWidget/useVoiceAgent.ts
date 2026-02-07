"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConversation, type Status } from "@elevenlabs/react";
import {
  createVoiceClientTools,
  setCanvasVoiceRuntime,
  type CanvasVoiceRuntime,
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

function normalizeRuntimeStatus(value: Status): CanvasVoiceRuntime["status"] {
  if (value === "connected") return "connected";
  if (value === "connecting") return "connecting";
  if (value === "disconnecting") return "disconnecting";
  return "disconnected";
}

function parseToolName(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as { tool_name?: unknown };
  return typeof record.tool_name === "string" && record.tool_name.trim()
    ? record.tool_name
    : null;
}

function parseToolResponseError(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as { is_error?: unknown };
  return Boolean(record.is_error);
}

export function useVoiceAgent() {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [starting, setStarting] = useState(false);
  const clientTools = useMemo(() => createVoiceClientTools(), []);
  const serverLocation = process.env.NEXT_PUBLIC_ELEVENLABS_SERVER_LOCATION;

  const conversation = useConversation({
    clientTools,
    serverLocation,
    onConnect: () => {
      setError(null);
    },
    onDisconnect: () => {
      setStarting(false);
      setCanvasVoiceRuntime({
        toolPhase: "idle",
        activeToolName: null,
        lastToolError: null,
        lastToolAt: Date.now(),
      });
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
    onUnhandledClientToolCall: (payload) => {
      const toolName = parseToolName(payload) ?? "unknown_tool";
      setCanvasVoiceRuntime({
        toolPhase: "failed",
        activeToolName: toolName,
        lastToolError: `Unhandled client tool call: ${toolName}.`,
        lastToolAt: Date.now(),
      });
    },
    onAgentToolRequest: (payload) => {
      const toolName = parseToolName(payload);
      setCanvasVoiceRuntime({
        toolPhase: "acting",
        activeToolName: toolName,
        lastToolError: null,
        lastToolAt: Date.now(),
      });
    },
    onAgentToolResponse: (payload) => {
      const toolName = parseToolName(payload);
      const isError = parseToolResponseError(payload);
      setCanvasVoiceRuntime({
        toolPhase: isError ? "failed" : "idle",
        activeToolName: isError ? toolName : null,
        lastToolError: isError ? `${toolName ?? "Tool"} failed.` : null,
        lastToolAt: Date.now(),
      });
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
  const getOutputByteFrequencyData = useCallback(
    () => conversation.getOutputByteFrequencyData(),
    [conversation]
  );
  const getInputByteFrequencyData = useCallback(
    () => conversation.getInputByteFrequencyData(),
    [conversation]
  );

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
    setCanvasVoiceRuntime({
      status: normalizeRuntimeStatus(status),
      isConnecting: starting || status === "connecting",
      isSpeaking,
      error,
      permissionDenied,
    });
  }, [error, isSpeaking, permissionDenied, starting, status]);

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
    getOutputByteFrequencyData,
    getInputByteFrequencyData,
  };
}

export type { TranscriptEntry };
