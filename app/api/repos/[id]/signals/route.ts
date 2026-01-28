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
  const target = new URL(`${baseUrl}/repos/${encodeURIComponent(params.id)}/signals`);
  for (const [key, value] of url.searchParams.entries()) {
    target.searchParams.set(key, value);
  }

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

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const baseUrl = internalApiBaseUrl();
  const body = await request.json().catch(() => null);
  const res = await fetch(
    `${baseUrl}/repos/${encodeURIComponent(params.id)}/signals`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }
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
