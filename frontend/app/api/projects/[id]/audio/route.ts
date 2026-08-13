import { NextResponse } from "next/server";

const backendUrl =
  process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;

    const formData = await request.formData();

    const response = await fetch(
      `${backendUrl}/projects/${id}/audio`,
      {
        method: "POST",
        body: formData,
        cache: "no-store",
      },
    );

    const data = await response.json().catch(() => ({
      detail: "Backend returned an invalid response.",
    }));

    return NextResponse.json(data, {
      status: response.status,
    });
  } catch (error) {
    console.error("Audio proxy error:", error);

    return NextResponse.json(
      {
        detail: "Failed to upload audio to backend.",
      },
      {
        status: 502,
      },
    );
  }
}
