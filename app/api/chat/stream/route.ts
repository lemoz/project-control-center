export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function internalApiBaseUrl() {
  return (
    process.env.CONTROL_CENTER_INTERNAL_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://localhost:4010"
  );
}

export async function GET(request: Request) {
  const baseUrl = internalApiBaseUrl();
  const url = new URL(request.url);
  const threadIdRaw = url.searchParams.get("thread_id");
  const threadId = threadIdRaw && threadIdRaw.trim() ? threadIdRaw : null;
  const params = new URLSearchParams();
  if (threadId) params.set("thread_id", threadId);
  const query = params.toString();
  const upstream = `${baseUrl}/chat/stream${query ? `?${query}` : ""}`;

  let res: Response;
  try {
    res = await fetch(upstream, {
      headers: { Accept: "text/event-stream" },
      cache: "no-store",
      signal: request.signal,
    });
  } catch {
    return new Response(JSON.stringify({ error: "Control Center server unreachable" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    return new Response(text || JSON.stringify({ error: "failed to connect chat stream" }), {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
      },
    });
  }

  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
