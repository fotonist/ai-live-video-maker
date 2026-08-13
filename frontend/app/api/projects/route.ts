import { NextResponse } from "next/server";

const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export async function POST(request: Request) {
  const body = await request.json();

  const response = await fetch(`${backendUrl}/projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: body.name,
    }),
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({
    detail: "Backend returned an invalid response.",
  }));

  return NextResponse.json(data, { status: response.status });
}
