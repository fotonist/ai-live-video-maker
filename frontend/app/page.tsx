"use client";

import { ChangeEvent, FormEvent, type CSSProperties, useEffect, useRef, useState } from "react";

const backendUrl = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "").replace(/\/$/, "");

type RenderStatus = "idle" | "rendering" | "completed" | "failed";
type RenderPhase = "preparing" | "scenes" | "scene-concat" | "audio-mux" | "completed" | "failed" | "idle";

type ApiError = { detail?: string };
type ProjectResponse = { id: string; status?: string; name?: string };
type RenderResponse = {
  project_id: string;
  status: string;
  video_url?: string;
  width?: number;
  height?: number;
  duration_seconds?: number;
  format?: string;
  error?: string | null;
  phase?: RenderPhase;
  message?: string;
  scene_current?: number;
  scene_total?: number;
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
  const [renderPhase, setRenderPhase] = useState<RenderPhase>("idle");
  const [renderMessage, setRenderMessage] = useState("");
  const [sceneCurrent, setSceneCurrent] = useState(0);
  const [sceneTotal, setSceneTotal] = useState(0);
  const [renderError, setRenderError] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
  }, []);

  function apiBase(): string {
    if (!backendUrl) throw new Error("NEXT_PUBLIC_BACKEND_URL is not configured.");
    return backendUrl;
  }

  async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${apiBase()}${path}`, options);
    const data = (await response.json().catch(() => null)) as T | ApiError | null;
    if (!response.ok) {
      const detail = data && typeof data === "object" && "detail" in data ? data.detail : undefined;
      throw new Error(detail || `Request failed (${response.status}).`);
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
    if (!projectName.trim()) throw new Error("Project name is required.");
    if (!lyrics.trim()) throw new Error("Lyrics are required.");
    if (!audioFile) throw new Error("Please upload an MP3 or WAV file.");

    setStatusMessage("Creating project...");
    const project = await apiFetch<ProjectResponse>("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: projectName.trim(), lyrics, format, singer, audio_file_name: audioFile.name }),
    });

    const id = project.id;
    setProjectId(id);
    setStatusMessage("Project created. Uploading audio...");

    const uploadForm = new FormData();
    uploadForm.append("file", audioFile, audioFile.name);
    const uploadResponse = await fetch(`${apiBase()}/projects/${id}/audio`, { method: "POST", body: uploadForm });
    const uploadData = (await uploadResponse.json().catch(() => null)) as { filename?: string; detail?: string } | null;
    if (!uploadResponse.ok) throw new Error(uploadData?.detail || "Audio upload failed.");
    setStatusMessage(`Audio uploaded${uploadData?.filename ? `: ${uploadData.filename}` : "."}`);
    return id;
  }

  async function analyzeProject(id: string) {
    setStatusMessage("Analyzing audio...");
    await apiFetch(`/projects/${id}/analyze`, { method: "POST" });
  }

  async function createStoryboard(id: string) {
    setStatusMessage("Building storyboard...");
    await apiFetch(`/projects/${id}/storyboard`, { method: "POST" });
  }

  async function startRender(id: string) {
    setStatusMessage("Starting video render...");
    setRenderStatus("rendering");
    setRenderPhase("preparing");
    setRenderMessage("Preparing render...");
    setSceneCurrent(0);
    setSceneTotal(0);
    setRenderError("");
    setVideoUrl("");
    await apiFetch<RenderResponse>(`/projects/${id}/render?output_format=${encodeURIComponent(format)}`, { method: "POST" });
  }

  async function pollRenderStatus(id: string) {
    try {
      const data = await apiFetch<RenderResponse>(`/projects/${id}/render/status`);
      const phase = data.phase ?? (data.status === "completed" ? "completed" : data.status === "failed" ? "failed" : "preparing");
      setRenderPhase(phase);
      setRenderMessage(data.message || "Rendering video...");
      setSceneCurrent(data.scene_current ?? 0);
      setSceneTotal(data.scene_total ?? 0);

      if (data.status === "completed") {
        setRenderStatus("completed");
        const relativeVideoUrl = data.video_url || `/projects/${id}/video`;
        setVideoUrl(relativeVideoUrl.startsWith("http") ? relativeVideoUrl : `${apiBase()}${relativeVideoUrl}`);
        setStatusMessage("Video rendering completed.");
        setIsProcessing(false);
        return;
      }

      if (data.status === "failed") {
        setRenderStatus("failed");
        setRenderPhase("failed");
        setRenderError(data.error || "Video rendering failed.");
        setStatusMessage("");
        setIsProcessing(false);
        return;
      }

      setRenderStatus("rendering");
      setStatusMessage(data.message || "Rendering video...");
      pollTimer.current = setTimeout(() => void pollRenderStatus(id), 2500);
    } catch (pollError) {
      console.warn("Render status check failed temporarily:", pollError);
      setRenderStatus("rendering");
      setRenderMessage("Connection interrupted. Checking render status again...");
      pollTimer.current = setTimeout(() => void pollRenderStatus(id), 5000);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || isProcessing) return;

    setError("");
    setRenderError("");
    setStatusMessage("");
    setProjectId("");
    setVideoUrl("");
    setRenderStatus("idle");
    setRenderPhase("idle");
    setSceneCurrent(0);
    setSceneTotal(0);
    setIsSubmitting(true);
    setIsProcessing(true);

    try {
      const id = await createProjectAndUploadAudio();
      await analyzeProject(id);
      await createStoryboard(id);
      await startRender(id);
      await pollRenderStatus(id);
    } catch (submitError) {
      setIsProcessing(false);
      setRenderStatus("failed");
      setRenderPhase("failed");
      setError(submitError instanceof Error ? submitError.message : "Project creation failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function downloadVideo() {
    if (!videoUrl) return;
    const link = document.createElement("a");
    link.href = videoUrl;
    link.download = `${projectName.trim() || "ai-live-video"}.mp4`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  const scenesDone = renderStatus === "completed" || renderPhase === "scene-concat" || renderPhase === "audio-mux";
  const concatDone = renderStatus === "completed" || renderPhase === "audio-mux";
  const muxDone = renderStatus === "completed";

  const stepState = (step: "scenes" | "concat" | "mux") => {
    if (renderStatus === "completed") return "done";
    if (step === "scenes") return scenesDone ? "done" : renderPhase === "scenes" || renderPhase === "preparing" ? "active" : "pending";
    if (step === "concat") return concatDone ? "done" : renderPhase === "scene-concat" ? "active" : "pending";
    return muxDone ? "done" : renderPhase === "audio-mux" ? "active" : "pending";
  };

  return (
    <main style={styles.page}>
      <div style={styles.backgroundGlow} />
      <section style={styles.shell}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>AI LIVE VIDEO MAKER</div>
            <h1 style={styles.title}>Turn a song into a live performance.</h1>
            <p style={styles.subtitle}>Upload your music and lyrics. Build an AI-generated concert video from one workflow.</p>
          </div>
          <div style={styles.status}>
            {renderStatus === "rendering" ? "Rendering" : renderStatus === "completed" ? "Completed" : "Ready"}
          </div>
        </header>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.card}>
            <label style={styles.label} htmlFor="project-name">Project name</label>
            <input id="project-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="My Concert Video" style={styles.input} disabled={isSubmitting || isProcessing} required />
          </div>

          <div style={styles.card}>
            <label style={styles.label} htmlFor="lyrics">Lyrics</label>
            <textarea id="lyrics" value={lyrics} onChange={(event) => setLyrics(event.target.value)} placeholder="Paste your song lyrics here..." style={styles.textarea} rows={9} disabled={isSubmitting || isProcessing} required />
            <div style={styles.helper}>{lyrics.length} characters</div>
          </div>

          <div style={styles.grid}>
            <div style={styles.card}>
              <label style={styles.label} htmlFor="audio">Music</label>
              <label htmlFor="audio" style={{ ...styles.uploadBox, ...(isSubmitting || isProcessing ? styles.disabledBox : {}) }}>
                <span style={styles.uploadIcon}>↑</span>
                <strong>{audioFile ? audioFile.name : "Upload MP3 or WAV"}</strong>
                <span style={styles.helper}>MP3/WAV · maximum 100 MB</span>
              </label>
              <input id="audio" type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/*" onChange={handleAudioChange} style={styles.hiddenInput} disabled={isSubmitting || isProcessing} />
            </div>

            <div style={styles.card}>
              <label style={styles.label}>Output format</label>
              <div style={styles.optionRow}>
                {["9:16", "16:9"].map((option) => <button key={option} type="button" onClick={() => setFormat(option)} style={{ ...styles.option, ...(format === option ? styles.optionActive : {}) }} disabled={isSubmitting || isProcessing}>{option}</button>)}
              </div>
              <label style={{ ...styles.label, marginTop: 24 }}>Singer</label>
              <div style={styles.optionRow}>
                {["Female", "Male"].map((option) => <button key={option} type="button" onClick={() => setSinger(option)} style={{ ...styles.option, ...(singer === option ? styles.optionActive : {}) }} disabled={isSubmitting || isProcessing}>{option}</button>)}
              </div>
            </div>
          </div>

          <div style={styles.footer}>
            <div>
              <div style={styles.footerTitle}>{renderStatus === "rendering" ? "Rendering in progress" : renderStatus === "completed" ? "Video ready" : "Ready to create"}</div>
              <div style={styles.helper}>{renderStatus === "rendering" ? renderMessage || "The page checks the render status automatically." : renderStatus === "completed" ? "Your MP4 video is ready." : "Create → Analyze → Storyboard → Render."}</div>
            </div>
            <button type="submit" style={{ ...styles.primaryButton, ...(isSubmitting || isProcessing ? styles.buttonDisabled : {}) }} disabled={isSubmitting || isProcessing}>
              {isSubmitting ? "Creating..." : isProcessing ? "Rendering..." : "Create & Render"}<span>→</span>
            </button>
          </div>
        </form>

        {projectId && <div style={styles.projectPanel}><div style={styles.projectLabel}>PROJECT</div><div style={styles.projectId}>{projectId}</div></div>}

        {renderStatus === "rendering" && (
          <div style={styles.renderingPanel} role="status">
            <div style={styles.renderHeader}>
              <div>
                <div style={styles.renderTitle}>Rendering video...</div>
                <div style={styles.renderMessage}>{renderMessage || "Preparing render..."}</div>
              </div>
              <div style={styles.sceneCounter}>{sceneTotal > 0 ? `${sceneCurrent}/${sceneTotal}` : "…"}</div>
            </div>

            <div style={styles.progressTrack}>
              <div style={{ ...styles.progressBar, width: `${sceneTotal > 0 ? Math.min(100, (sceneCurrent / sceneTotal) * 100) : 3}%` }} />
            </div>

            <div style={styles.checklist}>
              <RenderStep done active={false} label="Project created" detail="Project is ready." />
              <RenderStep done active={false} label="Audio uploaded" detail="Source audio is available." />
              <RenderStep done active={false} label="Audio analyzed" detail="Timing and energy analysis completed." />
              <RenderStep done active={false} label="Storyboard built" detail="Scenes are ready for rendering." />
              <RenderStep done={stepState("scenes") === "done"} active={stepState("scenes") === "active"} label="Rendering scenes" detail={sceneTotal > 0 ? `Scene ${Math.min(sceneCurrent + 1, sceneTotal)} of ${sceneTotal}` : "Preparing scenes..."} />
              <RenderStep done={stepState("concat") === "done"} active={stepState("concat") === "active"} label="Concatenating scenes" detail={stepState("concat") === "active" ? "Joining completed scene videos..." : "Waiting for all scenes."} />
              <RenderStep done={stepState("mux") === "done"} active={stepState("mux") === "active"} label="Adding audio & finalizing MP4" detail={stepState("mux") === "active" ? "Muxing audio and finalizing the file..." : "Waiting for visual render."} />
            </div>
          </div>
        )}

        {renderStatus === "completed" && videoUrl && (
          <div style={styles.success} role="status">
            <strong>Video is ready.</strong>
            <div style={styles.successActions}>
              <button type="button" onClick={downloadVideo} style={styles.downloadButton}>Download Video</button>
              <a href={videoUrl} target="_blank" rel="noopener noreferrer" style={styles.videoLink}>Open Video</a>
            </div>
          </div>
        )}

        {renderStatus === "failed" && (renderError || error) && (
          <div style={styles.error} role="alert">
            <strong>Rendering failed.</strong>
            <div style={styles.errorDetail}>{renderError || error}</div>
          </div>
        )}

        {statusMessage && renderStatus !== "rendering" && <div style={styles.info} role="status">{statusMessage}</div>}
      </section>
    </main>
  );
}

function RenderStep({ done, active, label, detail }: { done: boolean; active: boolean; label: string; detail: string }) {
  return (
    <div style={styles.step}>
      <div style={{ ...styles.stepIcon, ...(done ? styles.stepDone : active ? styles.stepActive : styles.stepPending) }}>{done ? "✓" : active ? "●" : "○"}</div>
      <div style={styles.stepBody}>
        <div style={styles.stepLabel}>{label}</div>
        <div style={styles.stepDetail}>{detail}</div>
      </div>
      {active && <div style={styles.live}>LIVE</div>}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: "100vh", background: "#07090d", color: "#f5f7fa", padding: "48px 24px", position: "relative", overflow: "hidden", fontFamily: "Arial, Helvetica, sans-serif" },
  backgroundGlow: { position: "absolute", width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, rgba(105, 80, 255, 0.20), transparent 68%)", top: -240, right: -140, pointerEvents: "none" },
  shell: { width: "100%", maxWidth: 1080, margin: "0 auto", position: "relative" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, marginBottom: 40 },
  eyebrow: { fontSize: 12, letterSpacing: "0.18em", fontWeight: 700, color: "#9ea7b7", marginBottom: 14 },
  title: { margin: 0, maxWidth: 760, fontSize: "clamp(36px, 6vw, 68px)", lineHeight: 0.98, letterSpacing: "-0.045em" },
  subtitle: { maxWidth: 650, color: "#a8b0bf", fontSize: 17, lineHeight: 1.6, margin: "20px 0 0" },
  status: { border: "1px solid #29303d", borderRadius: 999, padding: "8px 13px", color: "#aeb6c5", fontSize: 12, whiteSpace: "nowrap" },
  form: { display: "grid", gap: 18 },
  card: { background: "rgba(15, 18, 25, 0.90)", border: "1px solid #252b36", borderRadius: 18, padding: 22, boxShadow: "0 20px 60px rgba(0, 0, 0, 0.18)" },
  label: { display: "block", fontSize: 13, fontWeight: 700, color: "#dce1e9", marginBottom: 10 },
  input: { width: "100%", boxSizing: "border-box", background: "#0a0d12", color: "#fff", border: "1px solid #303744", borderRadius: 11, padding: "14px 15px", fontSize: 15, outline: "none" },
  textarea: { width: "100%", boxSizing: "border-box", resize: "vertical", background: "#0a0d12", color: "#fff", border: "1px solid #303744", borderRadius: 11, padding: 15, fontSize: 15, lineHeight: 1.6, outline: "none", fontFamily: "inherit" },
  helper: { color: "#737d8d", fontSize: 12, lineHeight: 1.5, marginTop: 8 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18 },
  uploadBox: { minHeight: 130, border: "1px dashed #394150", borderRadius: 13, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", cursor: "pointer", color: "#dfe4ec", padding: 18, boxSizing: "border-box" },
  disabledBox: { opacity: 0.55, cursor: "not-allowed" },
  uploadIcon: { width: 34, height: 34, borderRadius: "50%", display: "grid", placeItems: "center", border: "1px solid #394150", marginBottom: 10, color: "#aab3c2", fontSize: 18 },
  hiddenInput: { display: "none" },
  optionRow: { display: "flex", gap: 10 },
  option: { flex: 1, border: "1px solid #303744", background: "#0a0d12", color: "#aeb6c5", borderRadius: 10, padding: "12px 14px", cursor: "pointer", fontWeight: 700 },
  optionActive: { borderColor: "#7c6cff", color: "#fff", background: "#19152f" },
  footer: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, padding: "22px 2px 4px" },
  footerTitle: { fontSize: 15, fontWeight: 700 },
  primaryButton: { border: 0, borderRadius: 11, padding: "14px 22px", background: "#f4f5f7", color: "#080a0e", fontSize: 14, fontWeight: 800, cursor: "pointer", minWidth: 190 },
  buttonDisabled: { opacity: 0.55, cursor: "wait" },
  projectPanel: { marginTop: 20, padding: 16, borderRadius: 12, border: "1px solid #252b36", background: "#0d1016" },
  projectLabel: { color: "#737d8d", fontSize: 10, letterSpacing: "0.15em", fontWeight: 700 },
  projectId: { marginTop: 6, color: "#aeb6c5", fontSize: 12, fontFamily: "monospace", wordBreak: "break-all" },
  renderingPanel: { marginTop: 20, padding: 22, borderRadius: 16, border: "1px solid #39305d", background: "#110f1e" },
  renderHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 },
  renderTitle: { fontSize: 17, fontWeight: 800 },
  renderMessage: { color: "#aeb6c5", fontSize: 13, marginTop: 6 },
  sceneCounter: { fontFamily: "monospace", fontSize: 15, color: "#c8c1ff", fontWeight: 800 },
  progressTrack: { height: 6, background: "#29243b", borderRadius: 999, overflow: "hidden", marginTop: 20 },
  progressBar: { height: "100%", background: "#8a7cff", borderRadius: 999, transition: "width 0.4s ease" },
  checklist: { marginTop: 20, display: "grid", gap: 4 },
  step: { display: "flex", alignItems: "center", gap: 13, minHeight: 52, padding: "7px 8px", borderBottom: "1px solid #24202f" },
  stepIcon: { width: 27, height: 27, borderRadius: "50%", display: "grid", placeItems: "center", flex: "0 0 27px", fontSize: 13, fontWeight: 900 },
  stepDone: { background: "#19341f", color: "#83d99a", border: "1px solid #315b3b" },
  stepActive: { background: "#2a2350", color: "#c9c2ff", border: "1px solid #6558b5" },
  stepPending: { background: "#15131c", color: "#555064", border: "1px solid #302c3a" },
  stepBody: { minWidth: 0, flex: 1 },
  stepLabel: { fontSize: 13, fontWeight: 750, color: "#e0ddeb" },
  stepDetail: { color: "#747083", fontSize: 11, marginTop: 3 },
  live: { color: "#a99fff", fontSize: 9, fontWeight: 900, letterSpacing: "0.12em" },
  success: { marginTop: 20, padding: 20, borderRadius: 14, border: "1px solid #344436", background: "#101812", color: "#c9d7cb", fontSize: 14, lineHeight: 1.6 },
  successActions: { display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" },
  downloadButton: { border: 0, borderRadius: 10, padding: "12px 18px", background: "#f4f5f7", color: "#080a0e", fontSize: 13, fontWeight: 800, cursor: "pointer" },
  videoLink: { color: "#bdb6ff", fontSize: 13, fontWeight: 700, textDecoration: "none" },
  info: { marginTop: 20, padding: 16, borderRadius: 12, border: "1px solid #303744", background: "#0d1016", color: "#b8c0ce", fontSize: 14 },
  error: { marginTop: 20, padding: 16, borderRadius: 12, border: "1px solid #5b3030", background: "#1b0f11", color: "#e5c4c8", fontSize: 14, lineHeight: 1.6 },
  errorDetail: { marginTop: 8, color: "#c9aeb3", wordBreak: "break-word" },
};
