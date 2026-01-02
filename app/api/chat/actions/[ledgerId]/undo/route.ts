import { NextResponse } from "next/server";

function internalApiBaseUrl() {
  return (
    process.env.CONTROL_CENTER_INTERNAL_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    "http://localhost:4010"
  );
}

export async function POST(
  _request: Request,
  { params }: { params: { ledgerId: string } }
) {
  const baseUrl = internalApiBaseUrl();
  const res = await fetch(
    `${baseUrl}/chat/actions/${encodeURIComponent(params.ledgerId)}/undo`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
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

