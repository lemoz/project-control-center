import { NextResponse } from "next/server";

const FETCH_TIMEOUT_MS = 6000;

type EmbedCheckResult = {
  embeddable: boolean;
  reason: string | null;
  status: number | null;
};

function normalizeUrl(value: string | null): URL | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(
  url: string,
  method: "HEAD" | "GET"
): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": "PCC-Voice-Embed-Check/1.0",
      },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function evaluateXFrameOptions(params: {
  value: string | null;
  targetOrigin: string;
  requestOrigin: string;
}): { embeddable: boolean; reason: string } | null {
  const raw = params.value;
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized.includes("deny")) {
    return {
      embeddable: false,
      reason: "The site sends X-Frame-Options: DENY.",
    };
  }
  if (normalized.includes("sameorigin")) {
    if (params.targetOrigin === params.requestOrigin) {
      return { embeddable: true, reason: "X-Frame-Options allows same-origin embedding." };
    }
    return {
      embeddable: false,
      reason: "The site sends X-Frame-Options: SAMEORIGIN.",
    };
  }
  if (normalized.includes("allow-from")) {
    if (normalized.includes(params.requestOrigin.toLowerCase())) {
      return {
        embeddable: true,
        reason: "X-Frame-Options ALLOW-FROM includes this origin.",
      };
    }
    return {
      embeddable: false,
      reason: "The site sends X-Frame-Options: ALLOW-FROM for a different origin.",
    };
  }
  return null;
}

function extractFrameAncestors(csp: string | null): string[] | null {
  if (!csp) return null;
  const directives = csp
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const frameAncestors = directives.find((directive) =>
    directive.toLowerCase().startsWith("frame-ancestors")
  );
  if (!frameAncestors) return null;
  const tokens = frameAncestors
    .split(/\s+/)
    .slice(1)
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens;
}

function tokenAllowsOrigin(token: string, requestOrigin: string, targetOrigin: string): boolean {
  const normalized = token.replace(/,+$/, "").trim();
  if (!normalized) return false;
  if (normalized === "*") return true;
  if (normalized === "'self'") return requestOrigin === targetOrigin;
  if (normalized === "'none'") return false;
  if (normalized === "https:") return requestOrigin.startsWith("https://");
  if (normalized === "http:") return requestOrigin.startsWith("http://");
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    try {
      const origin = new URL(normalized).origin;
      return origin === requestOrigin;
    } catch {
      return false;
    }
  }
  return false;
}

function evaluateFrameAncestors(params: {
  tokens: string[] | null;
  requestOrigin: string;
  targetOrigin: string;
}): { embeddable: boolean; reason: string } | null {
  const { tokens } = params;
  if (!tokens) return null;
  if (tokens.length === 0) {
    return { embeddable: false, reason: "CSP frame-ancestors is empty." };
  }
  if (tokens.some((token) => token.replace(/,+$/, "").trim() === "'none'")) {
    return { embeddable: false, reason: "CSP frame-ancestors is set to 'none'." };
  }
  const allowed = tokens.some((token) =>
    tokenAllowsOrigin(token, params.requestOrigin, params.targetOrigin)
  );
  if (allowed) {
    return {
      embeddable: true,
      reason: "CSP frame-ancestors allows this origin.",
    };
  }
  return {
    embeddable: false,
    reason: "CSP frame-ancestors does not include this origin.",
  };
}

function evaluateEmbeddability(params: {
  response: Response;
  targetOrigin: string;
  requestOrigin: string;
}): EmbedCheckResult {
  const xfo = params.response.headers.get("x-frame-options");
  const csp = params.response.headers.get("content-security-policy");

  const xfoResult = evaluateXFrameOptions({
    value: xfo,
    targetOrigin: params.targetOrigin,
    requestOrigin: params.requestOrigin,
  });
  if (xfoResult) {
    return {
      embeddable: xfoResult.embeddable,
      reason: xfoResult.reason,
      status: params.response.status,
    };
  }

  const frameAncestors = extractFrameAncestors(csp);
  const cspResult = evaluateFrameAncestors({
    tokens: frameAncestors,
    requestOrigin: params.requestOrigin,
    targetOrigin: params.targetOrigin,
  });
  if (cspResult) {
    return {
      embeddable: cspResult.embeddable,
      reason: cspResult.reason,
      status: params.response.status,
    };
  }

  return {
    embeddable: true,
    reason: null,
    status: params.response.status,
  };
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const target = normalizeUrl(requestUrl.searchParams.get("url"));
  if (!target) {
    return NextResponse.json(
      {
        error: "A valid http/https `url` query parameter is required.",
      },
      { status: 400 }
    );
  }

  const requestOrigin = requestUrl.origin;
  const targetOrigin = target.origin;
  if (requestOrigin === targetOrigin) {
    return NextResponse.json({
      ok: true,
      embeddable: true,
      reason: "Same-origin URL.",
      status: 200,
    });
  }

  let response = await fetchWithTimeout(target.toString(), "HEAD");
  if (
    !response ||
    response.status === 405 ||
    response.status === 501 ||
    response.status === 403
  ) {
    response = await fetchWithTimeout(target.toString(), "GET");
  }
  if (!response) {
    return NextResponse.json(
      {
        ok: false,
        embeddable: true,
        reason: "Unable to verify embeddability. Try opening in a new tab.",
        status: null,
      },
      { status: 200 }
    );
  }

  const evaluation = evaluateEmbeddability({
    response,
    targetOrigin,
    requestOrigin,
  });

  return NextResponse.json({
    ok: true,
    embeddable: evaluation.embeddable,
    reason: evaluation.reason,
    status: evaluation.status,
  });
}
