"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  setCanvasVoiceState,
  useCanvasVoiceState,
} from "../landing/components/VoiceWidget/voiceClientTools";

type EmbedCheckResponse = {
  ok?: boolean;
  embeddable?: boolean;
  reason?: string;
};

type MermaidRuntime = {
  initialize: (config: Record<string, unknown>) => void;
  render: (
    id: string,
    definition: string
  ) => Promise<{ svg: string }> | { svg: string };
};

declare global {
  interface Window {
    mermaid?: MermaidRuntime;
    __pccMermaidLoader?: Promise<MermaidRuntime>;
  }
}

function loadMermaidRuntime(): Promise<MermaidRuntime> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Mermaid is only available in the browser."));
  }
  if (window.mermaid) {
    return Promise.resolve(window.mermaid);
  }
  if (window.__pccMermaidLoader) {
    return window.__pccMermaidLoader;
  }

  window.__pccMermaidLoader = new Promise<MermaidRuntime>((resolve, reject) => {
    const fail = (message: string) => {
      window.__pccMermaidLoader = undefined;
      reject(new Error(message));
    };
    const onLoad = () => {
      if (window.mermaid) {
        resolve(window.mermaid);
      } else {
        fail("Mermaid runtime did not initialize.");
      }
    };
    const onError = () => {
      fail("Failed to load Mermaid runtime.");
    };

    const existing = document.querySelector(
      'script[data-pcc-mermaid="1"]'
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", onLoad, { once: true });
      existing.addEventListener("error", onError, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
    script.dataset.pccMermaid = "1";
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    document.head.appendChild(script);
  });

  return window.__pccMermaidLoader;
}

function normalizeDiagramSource(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:mermaid)?\s*([\s\S]*?)```$/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return trimmed;
}

export function VoicePresentationModal() {
  const { presentation } = useCanvasVoiceState();
  const [diagramSvg, setDiagramSvg] = useState<string | null>(null);
  const [diagramError, setDiagramError] = useState<string | null>(null);
  const [websiteBlockedReason, setWebsiteBlockedReason] = useState<string | null>(
    null
  );
  const [websiteCheckLoading, setWebsiteCheckLoading] = useState(false);

  const close = useCallback(() => {
    setCanvasVoiceState({ presentation: null });
  }, []);

  const websiteUrl =
    presentation?.open && presentation.kind === "website"
      ? presentation.url
      : null;

  const diagramSource = useMemo(() => {
    if (!presentation?.open || presentation.kind !== "diagram") return "";
    return normalizeDiagramSource(presentation.content ?? "");
  }, [presentation]);

  useEffect(() => {
    if (!presentation?.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, presentation?.open]);

  useEffect(() => {
    if (!websiteUrl) {
      setWebsiteBlockedReason(null);
      setWebsiteCheckLoading(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;

    const check = async () => {
      setWebsiteCheckLoading(true);
      setWebsiteBlockedReason(null);
      try {
        const query = encodeURIComponent(websiteUrl);
        const response = await fetch(`/api/voice/embed-check?url=${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response
          .json()
          .catch(() => null)) as EmbedCheckResponse | null;
        if (cancelled) return;
        if (!response.ok) {
          setWebsiteBlockedReason(null);
          return;
        }
        if (payload?.embeddable === false) {
          setWebsiteBlockedReason(
            payload.reason || "This website blocks embedded previews."
          );
        }
      } catch {
        if (!cancelled) {
          setWebsiteBlockedReason(null);
        }
      } finally {
        if (!cancelled) {
          setWebsiteCheckLoading(false);
        }
      }
    };

    void check();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [websiteUrl]);

  useEffect(() => {
    if (!presentation?.open || presentation.kind !== "diagram") {
      setDiagramSvg(null);
      setDiagramError(null);
      return;
    }
    if (!diagramSource) {
      setDiagramSvg(null);
      setDiagramError("Diagram content is empty.");
      return;
    }

    let cancelled = false;
    const render = async () => {
      try {
        const mermaid = await loadMermaidRuntime();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "dark",
          suppressErrorRendering: true,
        });
        const renderId = `voice-mermaid-${Date.now()}-${Math.random()
          .toString(16)
          .slice(2)}`;
        const { svg } = await mermaid.render(renderId, diagramSource);
        if (cancelled) return;
        setDiagramSvg(svg);
        setDiagramError(null);
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : "Unable to render Mermaid diagram.";
        setDiagramSvg(null);
        setDiagramError(message);
      }
    };

    void render();
    return () => {
      cancelled = true;
    };
  }, [diagramSource, presentation?.kind, presentation?.open]);

  if (!presentation?.open) return null;

  const showWebsite = presentation.kind === "website" && Boolean(presentation.url);
  const showDiagram = presentation.kind === "diagram";
  const showText = presentation.kind !== "website" && presentation.kind !== "diagram";
  const websiteBlocked = Boolean(websiteBlockedReason);

  return (
    <aside className="voice-presentation-shell" aria-label="Voice presentation panel">
      <section className="voice-presentation-panel">
        <header className="voice-presentation-header">
          <div>
            <div className="voice-presentation-title">{presentation.title}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {presentation.kind === "website"
                ? "Website preview"
                : presentation.kind === "diagram"
                  ? "Diagram"
                  : presentation.kind === "markdown"
                    ? "Markdown"
                    : "Text"}
            </div>
          </div>
          <div className="voice-presentation-actions">
            {showWebsite && (
              <a
                className="btnSecondary"
                href={presentation.url ?? undefined}
                target="_blank"
                rel="noreferrer"
              >
                Open in new tab
              </a>
            )}
            <button type="button" className="btnSecondary" onClick={close}>
              Close
            </button>
          </div>
        </header>

        <div className="voice-presentation-body">
          {showWebsite && websiteCheckLoading && (
            <div className="voice-presentation-empty">
              <div className="muted">Checking website preview support...</div>
            </div>
          )}
          {showWebsite && websiteBlocked && (
            <div className="voice-presentation-empty">
              <div style={{ fontWeight: 700 }}>Website preview unavailable</div>
              <div className="muted" style={{ maxWidth: 560 }}>
                {websiteBlockedReason}
              </div>
              <a
                className="btn"
                href={presentation.url ?? undefined}
                target="_blank"
                rel="noreferrer"
              >
                Open in new tab
              </a>
            </div>
          )}
          {showWebsite && !websiteBlocked && !websiteCheckLoading && (
            <iframe
              title={presentation.title}
              src={presentation.url ?? undefined}
              className="voice-presentation-iframe"
              sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"
            />
          )}
          {showDiagram && diagramSvg && (
            <div
              className="voice-presentation-diagram"
              // Mermaid returns trusted SVG markup for the provided diagram definition.
              dangerouslySetInnerHTML={{ __html: diagramSvg }}
            />
          )}
          {showDiagram && !diagramSvg && (
            <div className="voice-presentation-empty">
              <div style={{ fontWeight: 700 }}>
                {diagramError ? "Diagram render failed" : "Rendering diagram..."}
              </div>
              {diagramError && (
                <div className="muted" style={{ maxWidth: 560 }}>
                  {diagramError}
                </div>
              )}
              <pre className="voice-presentation-content">
                {presentation.content ?? "No content."}
              </pre>
            </div>
          )}
          {showText && (
            <pre className="voice-presentation-content">
              {presentation.content ?? "No content."}
            </pre>
          )}
        </div>
      </section>
    </aside>
  );
}
