import { NextResponse } from "next/server";

function internalApiBaseUrl() {
  return (
    process.env.CONTROL_CENTER_INTERNAL_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://localhost:4010"
  );
}

export async function GET() {
  const baseUrl = internalApiBaseUrl();
  const res = await fetch(`${baseUrl}/settings/network-whitelist`, {
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
  const res = await fetch(`${baseUrl}/settings/network-whitelist`, {
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

export async function DELETE(request: Request) {
  const baseUrl = internalApiBaseUrl();
  const url = new URL(request.url);
  const domain = url.searchParams.get("domain");
  const target = domain
    ? `${baseUrl}/settings/network-whitelist?domain=${encodeURIComponent(domain)}`
    : `${baseUrl}/settings/network-whitelist`;

  const res = await fetch(target, { method: "DELETE" }).catch(() => null);

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
