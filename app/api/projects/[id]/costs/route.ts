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
  { params }: { params: { id: string } }
) {
  const baseUrl = internalApiBaseUrl();
  const url = new URL(request.url);
  const period = url.searchParams.get("period");
  const category = url.searchParams.get("category");
  const query = new URLSearchParams();
  if (period) query.set("period", period);
  if (category) query.set("category", category);
  const suffix = query.toString();
  const res = await fetch(
    `${baseUrl}/projects/${encodeURIComponent(params.id)}/costs${suffix ? `?${suffix}` : ""}`,
    { cache: "no-store" }
  ).catch(() => null);

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
