import { NextResponse } from "next/server";

function internalApiBaseUrl() {
  return (
    process.env.CONTROL_CENTER_INTERNAL_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://localhost:4010"
  );
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const baseUrl = internalApiBaseUrl();
  const res = await fetch(
    `${baseUrl}/projects/${encodeURIComponent(params.id)}/budget/enforcement`,
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
