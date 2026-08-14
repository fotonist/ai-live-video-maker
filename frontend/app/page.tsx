"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";

const backendUrl = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "").replace(/\/$/, "");

type RenderStatus = "idle" | "rendering" | "completed" | "failed";

type ApiError = {
  detail?: string;
};

type ProjectResponse = {
  id: string;
  status?: string;
  name?: string;
};

type RenderResponse = {
  project_id: string;
  status: string;
  video_url?: string;
  width?: number;
  height?: number;
  duration_seconds?: number;
  format?: string;
  error?: string | null;
};

export default function HomePage() {
  const [projectName, setProjectName] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [format, setFormat] = useState("9:16");
  const [singer, setSinger] = useState("Female");

  const [projectId, setProjectId] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [renderStatus, setRenderStatus] = useState<RenderStatus>("idle");
  const [renderError, setRenderError] = useState("");
  const [videoUrl, setVideoUrl] = useState("");

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
      }
    };
  }, []);

  function apiBase(): string {
    if (!backendUrl) {
      throw new Error("NEXT_PUBLIC_BACKEND_URL is not configured.");
    }
    return backendUrl;
  }

  async function apiFetch<T>(
    path: string,
    options?: RequestInit,
  ): Promise<T> {
    const response = await fetch(`${apiBase()}${path}`, options);

    const data = (await response.json().catch(() => null)) as
      | T
      | ApiError
      | null;

    if (!response.ok) {
      const detail =
        data && typeof data === "object" && "detail" in data
          ? data.detail
          : undefined;

      throw new Error(
        detail ||
          `Request failed (${response.status}).`,
      );
    }

    return data as T;
  }

  function handleAudioChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (file && !file.type.startsWith("audio/")) {
      setAudioFile(null);
      setError("Please select an MP3 or WAV audio file.");
      return;
    }

    if (file && file.size > 100 * 1024 * 1024) {
      setAudioFile(null);
      setError("Audio files must be 100 MB or smaller.");
      return;
    }

    setError("");
    setAudioFile(file);
  }

  async function createProjectAndUploadAudio(): Promise<string> {
    if (!projectName.trim()) {
      throw new Error("Project name is required.");
    }

    if (!lyrics.trim()) {
      throw new Error("Lyrics are required.");
    }

    if (!audioFile) {
      throw new Error("Please upload an MP3 or WAV file.");
    }

    setStatusMessage("Creating project...");

    const project = await apiFetch<ProjectResponse>("/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectName.trim(),
        lyrics,
        format,
        singer,
        audio_file_name: audioFile.name,
      }),
    });

    const id = project.id;

    setProjectId(id);
    setStatusMessage("Project created. Uploading audio...");

    const uploadForm = new FormData();
    uploadForm.append("file", audioFile, audioFile.name);

    const uploadResponse = await fetch(
      `${apiBase()}/projects/${id}/audio`,
      {
        method: "POST",
        body: uploadForm,
      },
    );

    const uploadData = (await uploadResponse.json().catch(() => null)) as
      | { filename?: string; detail?: string }
      | null;

    if (!uploadResponse.ok) {
      throw new Error(
        uploadData?.detail || "Audio upload failed.",
      );
    }

    setStatusMessage(
      `Audio uploaded${uploadData?.filename ? `: ${uploadData.filename}` : "."}`,
    );

    return id;
  }

  async function analyzeProject(id: string) {
    setStatusMessage("Analyzing audio...");
    await apiFetch(`/projects/${id}/analyze`, {
      method: "POST",
    });
  }

  async function createStoryboard(id: string) {
    setStatusMessage("Building storyboard...");
    await apiFetch(`/projects/${id}/storyboard`, {
      method: "POST",
    });
  }

  async function startRender(id: string) {
    setStatusMessage("Starting video render...");
    setRenderStatus("rendering");
    setRenderError("");
    setVideoUrl("");

    await apiFetch<RenderResponse>(
      `/projects/${id}/render?output_format=${encodeURIComponent(format)}`,
      {
        method: "POST",
      },
    );
  }

 async function pollRenderStatus(id: string) {
  try {
    const data = await apiFetch<RenderResponse>(
      `/projects/${id}/render/status`,
    );

    if (data.status === "completed") {
      setRenderStatus("completed");

      const relativeVideoUrl =
        data.video_url || `/projects/${id}/video`;

      setVideoUrl(
        relativeVideoUrl.startsWith("http")
          ? relativeVideoUrl
          : `${apiBase()}${relativeVideoUrl}`,
      );

      setStatusMessage("Video rendering completed.");
      setIsProcessing(false);
      return;
    }

    if (data.status === "failed") {
      setRenderStatus("failed");
      setRenderError(
        data.error || "Video rendering failed.",
      );
      setStatusMessage("");
      setIsProcessing(false);
      return;
    }

    // Still rendering
    setRenderStatus("rendering");
    setStatusMessage("Rendering video...");

    pollTimer.current = setTimeout(
      () => void pollRenderStatus(id),
      3000,
    );
  } catch (pollError) {
    /*
     * IMPORTANT:
     * A temporary network failure must NOT be treated
     * as a rendering failure.
     *
     * Render continues on the backend even if this
     * frontend request temporarily fails.
     */
    console.warn(
      "Render status check failed temporarily:",
      pollError,
    );

    setRenderStatus("rendering");
    setStatusMessage(
      "Connection interrupted. Checking render status again...",
    );

    pollTimer.current = setTimeout(
      () => void pollRenderStatus(id),
      5000,
    );
  }
}

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting || isProcessing) {
      return;
    }

    setError("");
    setRenderError("");
    setStatusMessage("");
    setProjectId("");
    setVideoUrl("");
    setRenderStatus("idle");
    setIsSubmitting(true);
    setIsProcessing(true);

    try {
      const id = await createProjectAndUploadAudio();
      await analyzeProject(id);
      await createStoryboard(id);
      await startRender(id);

      setStatusMessage(
        "Rendering started. This page will update automatically.",
      );

      await pollRenderStatus(id);
    } catch (submitError) {
      setIsProcessing(false);
      setRenderStatus("failed");
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Project creation failed.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function downloadVideo() {
    if (!videoUrl) {
      return;
    }

    const link = document.createElement("a");
    link.href = videoUrl;
    link.download = `${projectName.trim() || "ai-live-video"}.mp4`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return (
    <main style={styles.page}>
      <div style={styles.backgroundGlow} />

      <section style={styles.shell}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>AI LIVE VIDEO MAKER</div>
            <h1 style={styles.title}>
              Turn a song into a live performance.
            </h1>
            <p style={styles.subtitle}>
              Upload your music and lyrics. Build an AI-generated
              concert video from one workflow.
            </p>
          </div>

          <div style={styles.status}>
            {renderStatus === "rendering"
              ? "Rendering"
              : renderStatus === "completed"
                ? "Completed"
                : "Ready"}
          </div>
        </header>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.card}>
            <label style={styles.label} htmlFor="project-name">
              Project name
            </label>
            <input
              id="project-name"
              value={projectName}
              onChange={(event) =>
                setProjectName(event.target.value)
              }
              placeholder="My Concert Video"
              style={styles.input}
              disabled={isSubmitting || isProcessing}
              required
            />
          </div>

          <div style={styles.card}>
            <label style={styles.label} htmlFor="lyrics">
              Lyrics
            </label>
            <textarea
              id="lyrics"
              value={lyrics}
              onChange={(event) =>
                setLyrics(event.target.value)
              }
              placeholder="Paste your song lyrics here..."
              style={styles.textarea}
              rows={9}
              disabled={isSubmitting || isProcessing}
              required
            />
            <div style={styles.helper}>
              {lyrics.length} characters
            </div>
          </div>

          <div style={styles.grid}>
            <div style={styles.card}>
              <label style={styles.label} htmlFor="audio">
                Music
              </label>

              <label
                htmlFor="audio"
                style={{
                  ...styles.uploadBox,
                  ...(isSubmitting || isProcessing
                    ? styles.disabledBox
                    : {}),
                }}
              >
                <span style={styles.uploadIcon}>↑</span>
                <strong>
                  {audioFile
                    ? audioFile.name
                    : "Upload MP3 or WAV"}
                </strong>
                <span style={styles.helper}>
                  MP3/WAV · maximum 100 MB
                </span>
              </label>

              <input
                id="audio"
                type="file"
                accept="audio/mpeg,audio/wav,audio/x-wav,audio/*"
                onChange={handleAudioChange}
                style={styles.hiddenInput}
                disabled={isSubmitting || isProcessing}
              />
            </div>

            <div style={styles.card}>
              <label style={styles.label}>
                Output format
              </label>

              <div style={styles.optionRow}>
                {["9:16", "16:9"].map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setFormat(option)}
                    style={{
                      ...styles.option,
                      ...(format === option
                        ? styles.optionActive
                        : {}),
                    }}
                    disabled={isSubmitting || isProcessing}
                  >
                    {option}
                  </button>
                ))}
              </div>

              <label
                style={{
                  ...styles.label,
                  marginTop: 24,
                }}
              >
                Singer
              </label>

              <div style={styles.optionRow}>
                {["Female", "Male"].map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSinger(option)}
                    style={{
                      ...styles.option,
                      ...(singer === option
                        ? styles.optionActive
                        : {}),
                    }}
                    disabled={isSubmitting || isProcessing}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={styles.footer}>
            <div>
              <div style={styles.footerTitle}>
                {renderStatus === "rendering"
                  ? "Rendering in progress"
                  : renderStatus === "completed"
                    ? "Video ready"
                    : "Ready to create"}
              </div>

              <div style={styles.helper}>
                {renderStatus === "rendering"
                  ? "The page checks the render status automatically."
                  : renderStatus === "completed"
                    ? "Your MP4 video is ready."
                    : "Create → Analyze → Storyboard → Render."}
              </div>
            </div>

            <button
              type="submit"
              style={{
                ...styles.primaryButton,
                ...(isSubmitting || isProcessing
                  ? styles.buttonDisabled
                  : {}),
              }}
              disabled={isSubmitting || isProcessing}
            >
              {isSubmitting
                ? "Creating..."
                : isProcessing
                  ? "Rendering..."
                  : "Create & Render"}
              <span>→</span>
            </button>
          </div>
        </form>

        {projectId && (
          <div style={styles.projectPanel}>
            <div style={styles.projectLabel}>
              PROJECT
            </div>
            <div style={styles.projectId}>{projectId}</div>
          </div>
        )}

        {renderStatus === "rendering" && (
          <div style={styles.renderingPanel} role="status">
            <div style={styles.spinner} />
            <div>
              <strong>Rendering video...</strong>
              <div style={styles.helper}>
                Keep this page open. We will automatically detect
                when the MP4 is ready.
              </div>
            </div>
          </div>
        )}

        {renderStatus === "completed" && videoUrl && (
          <div style={styles.success} role="status">
            <strong>Video is ready.</strong>

            <div style={styles.successActions}>
              <button
                type="button"
                onClick={downloadVideo}
                style={styles.downloadButton}
              >
                Download Video
              </button>

              <a
                href={videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.videoLink}
              >
                Open Video
              </a>
            </div>
          </div>
        )}

        {renderStatus === "failed" && renderError && (
          <div style={styles.error} role="alert">
            <strong>Rendering failed.</strong>
            <div style={styles.errorDetail}>
              {renderError}
            </div>
          </div>
        )}

        {statusMessage && renderStatus !== "rendering" && (
          <div style={styles.info} role="status">
            {statusMessage}
          </div>
        )}

        {error && (
          <div style={styles.error} role="alert">
            <strong>Could not complete the workflow.</strong>
            <div style={styles.errorDetail}>{error}</div>
          </div>
        )}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#07090d",
    color: "#f5f7fa",
    padding: "48px 24px",
    position: "relative",
    overflow: "hidden",
    fontFamily: "Arial, Helvetica, sans-serif",
  },

  backgroundGlow: {
    position: "absolute",
    width: 520,
    height: 520,
    borderRadius: "50%",
    background:
      "radial-gradient(circle, rgba(105, 80, 255, 0.20), transparent 68%)",
    top: -240,
    right: -140,
    pointerEvents: "none",
  },

  shell: {
    width: "100%",
    maxWidth: 1080,
    margin: "0 auto",
    position: "relative",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 24,
    marginBottom: 40,
  },

  eyebrow: {
    fontSize: 12,
    letterSpacing: "0.18em",
    fontWeight: 700,
    color: "#9ea7b7",
    marginBottom: 14,
  },

  title: {
    margin: 0,
    maxWidth: 760,
    fontSize: "clamp(36px, 6vw, 68px)",
    lineHeight: 0.98,
    letterSpacing: "-0.045em",
  },

  subtitle: {
    maxWidth: 650,
    color: "#a8b0bf",
    fontSize: 17,
    lineHeight: 1.6,
    margin: "20px 0 0",
  },

  status: {
    border: "1px solid #29303d",
    borderRadius: 999,
    padding: "8px 13px",
    color: "#aeb6c5",
    fontSize: 12,
    whiteSpace: "nowrap",
  },

  form: {
    display: "grid",
    gap: 18,
  },

  card: {
    background: "rgba(15, 18, 25, 0.90)",
    border: "1px solid #252b36",
    borderRadius: 18,
    padding: 22,
    boxShadow: "0 20px 60px rgba(0, 0, 0, 0.18)",
  },

  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 700,
    color: "#dce1e9",
    marginBottom: 10,
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    background: "#0a0d12",
    color: "#fff",
    border: "1px solid #303744",
    borderRadius: 11,
    padding: "14px 15px",
    fontSize: 15,
    outline: "none",
  },

  textarea: {
    width: "100%",
    boxSizing: "border-box",
    resize: "vertical",
    background: "#0a0d12",
    color: "#fff",
    border: "1px solid #303744",
    borderRadius: 11,
    padding: 15,
    fontSize: 15,
    lineHeight: 1.6,
    outline: "none",
    fontFamily: "inherit",
  },

  helper: {
    color: "#737d8d",
    fontSize: 12,
    lineHeight: 1.5,
    marginTop: 8,
  },

  grid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(300px, 1fr))",
    gap: 18,
  },

  uploadBox: {
    minHeight: 130,
    border: "1px dashed #394150",
    borderRadius: 13,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    cursor: "pointer",
    color: "#dfe4ec",
    padding: 18,
    boxSizing: "border-box",
  },

  disabledBox: {
    opacity: 0.55,
    cursor: "not-allowed",
  },

  uploadIcon: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    border: "1px solid #394150",
    marginBottom: 10,
    color: "#aab3c2",
    fontSize: 18,
  },

  hiddenInput: {
    display: "none",
  },

  optionRow: {
    display: "flex",
    gap: 10,
  },

  option: {
    flex: 1,
    border: "1px solid #303744",
    background: "#0a0d12",
    color: "#aeb6c5",
    borderRadius: 10,
    padding: "12px 14px",
    cursor: "pointer",
    fontWeight: 700,
  },

  optionActive: {
    borderColor: "#7c6cff",
    color: "#fff",
    background: "#19152f",
  },

  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 20,
    padding: "22px 2px 4px",
  },

  footerTitle: {
    fontSize: 15,
    fontWeight: 700,
  },

  primaryButton: {
    border: 0,
    borderRadius: 11,
    padding: "14px 22px",
    background: "#f4f5f7",
    color: "#080a0e",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
    minWidth: 190,
  },

  buttonDisabled: {
    opacity: 0.55,
    cursor: "wait",
  },

  projectPanel: {
    marginTop: 20,
    padding: 16,
    borderRadius: 12,
    border: "1px solid #252b36",
    background: "#0d1016",
  },

  projectLabel: {
    color: "#737d8d",
    fontSize: 10,
    letterSpacing: "0.15em",
    fontWeight: 700,
  },

  projectId: {
    marginTop: 6,
    color: "#aeb6c5",
    fontSize: 12,
    fontFamily: "monospace",
    wordBreak: "break-all",
  },

  renderingPanel: {
    marginTop: 20,
    padding: 20,
    borderRadius: 14,
    border: "1px solid #39305d",
    background: "#110f1e",
    display: "flex",
    alignItems: "center",
    gap: 16,
  },

  spinner: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    border: "3px solid #353044",
    borderTopColor: "#8a7cff",
    animation: "spin 1s linear infinite",
  },

  success: {
    marginTop: 20,
    padding: 20,
    borderRadius: 14,
    border: "1px solid #344436",
    background: "#101812",
    color: "#c9d7cb",
    fontSize: 14,
    lineHeight: 1.6,
  },

  successActions: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 16,
    flexWrap: "wrap",
  },

  downloadButton: {
    border: 0,
    borderRadius: 10,
    padding: "12px 18px",
    background: "#f4f5f7",
    color: "#080a0e",
    fontSize: 13,
    fontWeight: 800,
    cursor: "pointer",
  },

  videoLink: {
    color: "#bdb6ff",
    fontSize: 13,
    fontWeight: 700,
    textDecoration: "none",
  },

  info: {
    marginTop: 20,
    padding: 16,
    borderRadius: 12,
    border: "1px solid #303744",
    background: "#0d1016",
    color: "#b8c0ce",
    fontSize: 14,
  },

  error: {
    marginTop: 20,
    padding: 16,
    borderRadius: 12,
    border: "1px solid #5b3030",
    background: "#1b0f11",
    color: "#e5c4c8",
    fontSize: 14,
    lineHeight: 1.6,
  },

  errorDetail: {
    marginTop: 8,
    color: "#c9aeb3",
    wordBreak: "break-word",
  },
};
