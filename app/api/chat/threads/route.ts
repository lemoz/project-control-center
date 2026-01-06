import { NextResponse } from "next/server";

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
  const params = new URLSearchParams();
  const includeArchived = url.searchParams.get("include_archived");
  const limit = url.searchParams.get("limit");
  if (includeArchived) params.set("include_archived", includeArchived);
  if (limit) params.set("limit", limit);
  const query = params.toString();
  const res = await fetch(`${baseUrl}/chat/threads${query ? `?${query}` : ""}`, {
    cache: "no-store",
  }).catch(() => null);

  if (!res) {
    return NextResponse.json(
      { error: "Control Center server unreachable" },
      { status: 502 }
    );
  }

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(request: Request) {
  const baseUrl = internalApiBaseUrl();
  const body = await request.json().catch(() => null);
  const res = await fetch(`${baseUrl}/chat/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).catch(() => null);

  if (!res) {
    return NextResponse.json(
      { error: "Control Center server unreachable" },
      { status: 502 }
    );
  }

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
