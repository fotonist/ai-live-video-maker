import { NextResponse } from "next/server";

const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await context.params;
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { detail: "Audio file is required." },
      { status: 400 },
    );
  }

  const backendForm = new FormData();
  backendForm.append("file", file, file.name);

  const response = await fetch(`${backendUrl}/projects/${projectId}/audio`, {
    method: "POST",
    body: backendForm,
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({
    detail: "Backend returned an invalid response.",
  }));

  return NextResponse.json(data, { status: response.status });
}
