"use client";

import { ChangeEvent, FormEvent, useState } from "react";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  "https://ai-live-video-maker.onrender.com";

export default function HomePage() {
  const [projectName, setProjectName] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [format, setFormat] = useState("9:16");
  const [singer, setSinger] = useState("Female");

  const [statusMessage, setStatusMessage] = useState("");
  const [projectId, setProjectId] = useState("");
  const [videoUrl, setVideoUrl] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

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

  async function postJson(path: string, init?: RequestInit) {
    const response = await fetch(`${BACKEND_URL}${path}`, init);

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(
        data?.detail ?? `Request failed (${response.status}).`
      );
    }

    return data;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setStatusMessage("");
    setProjectId("");
    setVideoUrl("");
    setIsSubmitting(true);

    try {
      // ---------------------------------------------------------
      // 1. CREATE PROJECT
      // ---------------------------------------------------------

      setStatusMessage("Creating project...");

      const project = await postJson("/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: projectName.trim(),
          lyrics,
          format,
          singer,
          audio_file_name: audioFile?.name ?? null,
        }),
      });

      setProjectId(project.id);

      if (!audioFile) {
        setStatusMessage(`Project created as ${project.status}.`);
        return;
      }

      // ---------------------------------------------------------
      // 2. UPLOAD AUDIO
      // ---------------------------------------------------------

      setStatusMessage("Uploading audio...");

      const uploadForm = new FormData();

      uploadForm.append(
        "file",
        audioFile,
        audioFile.name
      );

      await postJson(
        `/projects/${project.id}/audio`,
        {
          method: "POST",
          body: uploadForm,
        }
      );

      // ---------------------------------------------------------
      // 3. ANALYZE AUDIO
      // ---------------------------------------------------------

      setStatusMessage("Analyzing audio...");

      await postJson(
        `/projects/${project.id}/analyze`,
        {
          method: "POST",
        }
      );

      // ---------------------------------------------------------
      // 4. BUILD STORYBOARD
      // ---------------------------------------------------------

      setStatusMessage("Building storyboard...");

      await postJson(
        `/projects/${project.id}/storyboard`,
        {
          method: "POST",
        }
      );

      // ---------------------------------------------------------
      // 5. RENDER VIDEO
      // ---------------------------------------------------------

      setStatusMessage(
        "Rendering video... This can take a little while."
      );

      const render = await postJson(
        `/projects/${project.id}/render?output_format=${encodeURIComponent(
          format
        )}`,
        {
          method: "POST",
        }
      );

      // ---------------------------------------------------------
      // 6. VIDEO URL
      // ---------------------------------------------------------

      const absoluteVideoUrl =
        render.video_url.startsWith("http")
          ? render.video_url
          : `${BACKEND_URL}${render.video_url}`;

      setVideoUrl(absoluteVideoUrl);

      setStatusMessage(
        "Video rendered successfully."
      );
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Video creation failed."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.backgroundGlow} />

      <section style={styles.shell}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>
              AI LIVE VIDEO MAKER
            </div>

            <h1 style={styles.title}>
              Turn a song into a live performance.
            </h1>

            <p style={styles.subtitle}>
              Upload your music and lyrics. Build and render
              the first version of your AI-generated concert
              video.
            </p>
          </div>

          <div style={styles.status}>
            Prototype
          </div>
        </header>

        <form
          onSubmit={handleSubmit}
          style={styles.form}
        >
          {/* PROJECT NAME */}

          <div style={styles.card}>
            <label
              style={styles.label}
              htmlFor="project-name"
            >
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
              required
            />
          </div>

          {/* LYRICS */}

          <div style={styles.card}>
            <label
              style={styles.label}
              htmlFor="lyrics"
            >
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
              required
            />

            <div style={styles.helper}>
              {lyrics.length} characters
            </div>
          </div>

          <div style={styles.grid}>
            {/* AUDIO */}

            <div style={styles.card}>
              <label
                style={styles.label}
                htmlFor="audio"
              >
                Music
              </label>

              <label
                htmlFor="audio"
                style={styles.uploadBox}
              >
                <span style={styles.uploadIcon}>
                  ↑
                </span>

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
              />
            </div>

            {/* OPTIONS */}

            <div style={styles.card}>
              <label style={styles.label}>
                Output format
              </label>

              <div style={styles.optionRow}>
                {["9:16", "16:9"].map(
                  (option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() =>
                        setFormat(option)
                      }
                      style={{
                        ...styles.option,
                        ...(format === option
                          ? styles.optionActive
                          : {}),
                      }}
                    >
                      {option}
                    </button>
                  )
                )}
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
                {["Female", "Male"].map(
                  (option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() =>
                        setSinger(option)
                      }
                      style={{
                        ...styles.option,
                        ...(singer === option
                          ? styles.optionActive
                          : {}),
                      }}
                    >
                      {option}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>

          {/* ACTION */}

          <div style={styles.footer}>
            <div>
              <div style={styles.footerTitle}>
                Ready to create
              </div>

              <div style={styles.helper}>
                {audioFile
                  ? "Create → Upload → Analyze → Storyboard → Render"
                  : "Add an audio file to render a video."}
              </div>
            </div>

            <button
              type="submit"
              style={styles.primaryButton}
              disabled={isSubmitting}
            >
              {isSubmitting
                ? "Creating..."
                : "Create Video"}

              <span>→</span>
            </button>
          </div>
        </form>

        {/* SUCCESS */}

        {statusMessage && (
          <div
            style={styles.success}
            role="status"
          >
            <strong>
              {statusMessage}
            </strong>

            {projectId && (
              <div style={styles.helper}>
                Project ID: {projectId}
              </div>
            )}

            {videoUrl && (
              <div style={styles.videoActions}>
                <a
                  href={videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={styles.videoLink}
                >
                  Open MP4
                </a>

                <a
                  href={videoUrl}
                  download
                  style={styles.downloadLink}
                >
                  Download MP4
                </a>
              </div>
            )}
          </div>
        )}

        {/* ERROR */}

        {error && (
          <div
            style={styles.error}
            role="alert"
          >
            <strong>
              Could not create the video.
            </strong>

            <div>{error}</div>
          </div>
        )}
      </section>
    </main>
  );
}

const styles: Record<
  string,
  React.CSSProperties
> = {
  page: {
    minHeight: "100vh",
    background: "#07090d",
    color: "#f5f7fa",
    padding: "48px 24px",
    position: "relative",
    overflow: "hidden",
    fontFamily:
      "Arial, Helvetica, sans-serif",
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
    fontSize:
      "clamp(36px, 6vw, 68px)",
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
    background:
      "rgba(15, 18, 25, 0.90)",
    border: "1px solid #252b36",
    borderRadius: 18,
    padding: 22,
    boxShadow:
      "0 20px 60px rgba(0, 0, 0, 0.18)",
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
    minWidth: 170,
  },

  success: {
    marginTop: 20,
    padding: 16,
    borderRadius: 12,
    border: "1px solid #344436",
    background: "#101812",
    color: "#c9d7cb",
    fontSize: 14,
    lineHeight: 1.6,
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

  videoActions: {
    display: "flex",
    gap: 10,
    marginTop: 14,
    flexWrap: "wrap",
  },

  videoLink: {
    display: "inline-block",
    border: "1px solid #394150",
    borderRadius: 9,
    padding: "10px 14px",
    color: "#dfe4ec",
    textDecoration: "none",
    fontWeight: 700,
  },

  downloadLink: {
    display: "inline-block",
    borderRadius: 9,
    padding: "10px 14px",
    background: "#f4f5f7",
    color: "#080a0e",
    textDecoration: "none",
    fontWeight: 800,
  },
};
