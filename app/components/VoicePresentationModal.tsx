"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
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

const DOCK_MARGIN_PX = 12;

type PresentationDockLayout = {
  rightOffsetPx: number;
  bottomOffsetPx: number;
};

function defaultDockLayout(): PresentationDockLayout {
  return {
    rightOffsetPx: DOCK_MARGIN_PX,
    bottomOffsetPx: DOCK_MARGIN_PX,
  };
}

function isVisibleElement(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  if (rect.bottom < 0 || rect.top > window.innerHeight) {
    return false;
  }
  if (rect.right < 0 || rect.left > window.innerWidth) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }
  return true;
}

function measureDockLayout(): PresentationDockLayout {
  if (typeof window === "undefined") {
    return defaultDockLayout();
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let rightOffsetPx = DOCK_MARGIN_PX;
  let bottomOffsetPx = DOCK_MARGIN_PX;

  const detailPanels = Array.from(
    document.querySelectorAll<HTMLElement>('[data-pcc-overlay="detail-panel"]')
  );
  for (const panel of detailPanels) {
    if (!isVisibleElement(panel)) continue;
    const rect = panel.getBoundingClientRect();
    const widthRatio = rect.width / Math.max(viewportWidth, 1);
    const anchoredBottom = rect.bottom >= viewportHeight - 2;

    if (widthRatio > 0.55 && anchoredBottom) {
      // On narrow layouts the detail panel behaves like a bottom sheet,
      // so move the presentation panel upward instead of pushing left.
      const occupiedFromBottom = viewportHeight - rect.top;
      bottomOffsetPx = Math.max(bottomOffsetPx, occupiedFromBottom + DOCK_MARGIN_PX);
      continue;
    }

    const occupiedFromRight = viewportWidth - rect.left;
    rightOffsetPx = Math.max(rightOffsetPx, occupiedFromRight + DOCK_MARGIN_PX);
  }

  const chatWidget = document.querySelector<HTMLElement>(".chat-widget");
  if (chatWidget && isVisibleElement(chatWidget)) {
    const rect = chatWidget.getBoundingClientRect();
    const occupiedFromBottom = viewportHeight - rect.top;
    bottomOffsetPx = Math.max(bottomOffsetPx, occupiedFromBottom + 8);
  }

  return {
    rightOffsetPx: Math.round(rightOffsetPx),
    bottomOffsetPx: Math.round(bottomOffsetPx),
  };
}

export function VoicePresentationModal() {
  const { presentation } = useCanvasVoiceState();
  const [diagramSvg, setDiagramSvg] = useState<string | null>(null);
  const [diagramError, setDiagramError] = useState<string | null>(null);
  const [websiteBlockedReason, setWebsiteBlockedReason] = useState<string | null>(
    null
  );
  const [websiteCheckLoading, setWebsiteCheckLoading] = useState(false);
  const [dockLayout, setDockLayout] = useState<PresentationDockLayout>(
    defaultDockLayout
  );

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

  const recalculateDockLayout = useCallback(() => {
    const next = measureDockLayout();
    setDockLayout((previous) => {
      if (
        previous.rightOffsetPx === next.rightOffsetPx &&
        previous.bottomOffsetPx === next.bottomOffsetPx
      ) {
        return previous;
      }
      return next;
    });
  }, []);

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

  useEffect(() => {
    if (!presentation?.open) {
      setDockLayout(defaultDockLayout());
      return;
    }

    recalculateDockLayout();
    if (typeof window === "undefined") return;

    const reconnectResizeTargets = (
      observer: ResizeObserver | null
    ): void => {
      if (!observer) return;
      observer.disconnect();
      const targets = document.querySelectorAll<HTMLElement>(
        '[data-pcc-overlay="detail-panel"], .chat-widget'
      );
      targets.forEach((target) => observer.observe(target));
    };

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            recalculateDockLayout();
          })
        : null;

    reconnectResizeTargets(resizeObserver);

    const mutationObserver = new MutationObserver(() => {
      reconnectResizeTargets(resizeObserver);
      recalculateDockLayout();
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    const onWindowResize = () => {
      reconnectResizeTargets(resizeObserver);
      recalculateDockLayout();
    };
    window.addEventListener("resize", onWindowResize);

    return () => {
      window.removeEventListener("resize", onWindowResize);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
    };
  }, [presentation?.open, recalculateDockLayout]);

  if (!presentation?.open) return null;

  const showWebsite = presentation.kind === "website" && Boolean(presentation.url);
  const showDiagram = presentation.kind === "diagram";
  const showText = presentation.kind !== "website" && presentation.kind !== "diagram";
  const websiteBlocked = Boolean(websiteBlockedReason);
  const shellStyle = {
    "--voice-presentation-right": `${dockLayout.rightOffsetPx}px`,
    "--voice-presentation-bottom": `${dockLayout.bottomOffsetPx}px`,
  } as CSSProperties;

  return (
    <aside
      className="voice-presentation-shell"
      style={shellStyle}
      data-pcc-overlay="voice-presentation"
      aria-label="Voice presentation panel"
    >
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
