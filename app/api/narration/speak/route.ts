import { NextResponse } from "next/server";

function internalApiBaseUrl() {
  return (
    process.env.CONTROL_CENTER_INTERNAL_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://localhost:4010"
  );
}

export async function POST(request: Request) {
  const baseUrl = internalApiBaseUrl();
  const body = await request.json().catch(() => null);
  const res = await fetch(`${baseUrl}/narration/speak`, {
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

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": contentType || "application/json" },
    });
  }

  const audio = await res.arrayBuffer();
  return new NextResponse(audio, {
    status: res.status,
    headers: { "content-type": contentType || "audio/mpeg" },
  });
}
