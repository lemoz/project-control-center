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
  const scope = url.searchParams.get("scope");
  const projectId = url.searchParams.get("projectId");

  const target = new URL("/constitution/versions", baseUrl);
  if (scope) target.searchParams.set("scope", scope);
  if (projectId) target.searchParams.set("projectId", projectId);

  const res = await fetch(target.toString(), { cache: "no-store" }).catch(
    () => null
  );
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
