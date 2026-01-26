import { NextResponse } from "next/server";

function internalApiBaseUrl() {
  return (
    process.env.CONTROL_CENTER_INTERNAL_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://localhost:4010"
  );
}

export async function GET(
  request: Request,
  { params }: { params: { id: string; shiftId: string } }
) {
  const baseUrl = internalApiBaseUrl();
  const url = new URL(request.url);
  const target = new URL(
    `${baseUrl}/projects/${encodeURIComponent(params.id)}/shifts/${encodeURIComponent(
      params.shiftId
    )}/logs`
  );
  const tail = url.searchParams.get("tail") ?? url.searchParams.get("lines");
  if (tail) target.searchParams.set("tail", tail);

  const res = await fetch(target.toString(), { cache: "no-store" }).catch(() => null);
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
