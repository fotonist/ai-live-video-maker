"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";

const backendUrl = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "").replace(/\/$/, "");

type StatusResponse = {
  id: string;
  status: string;
  phase: string;
  message?: string;
  video_url?: string;
  error?: string | null;
};

type ApiError = { detail?: string };

export default function SingingTestPage() {
  const [image, setImage] = useState<File | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [jobId, setJobId] = useState("");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setImage(file);
    setError("");
  }

  function selectAudio(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setAudio(file);
    setError("");
  }

  async function request<T>(path: string, options?: RequestInit): Promise<T> {
    if (!backendUrl) throw new Error("NEXT_PUBLIC_BACKEND_URL is not configured.");
    const response = await fetch(`${backendUrl}${path}`, options);
    const data = (await response.json().catch(() => null)) as T | ApiError | null;
    if (!response.ok) {
      const detail = data && typeof data === "object" && "detail" in data ? data.detail : undefined;
      throw new Error(detail || `Request failed (${response.status}).`);
    }
    return data as T;
  }

  async function poll(id: string) {
    try {
      const data = await request<StatusResponse>(`/singing-test/${id}`);
      setStatus(data);
      if (data.status === "completed" || data.status === "failed") return;
      pollRef.current = setTimeout(() => void poll(id), 4000);
    } catch (pollError) {
      setError(pollError instanceof Error ? pollError.message : "Status check failed.");
      pollRef.current = setTimeout(() => void poll(id), 5000);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!image || !audio || submitting) return;
    setError("");
    setStatus(null);
    setJobId("");
    setSubmitting(true);

    try {
      const form = new FormData();
      form.append("image", image, image.name);
      form.append("audio", audio, audio.name);
      const created = await request<StatusResponse>("/singing-test", { method: "POST", body: form });
      setJobId(created.id);
      setStatus(created);
      await poll(created.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Singing test failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const videoUrl = status?.status === "completed" && jobId ? `${backendUrl}/singing-test/${jobId}/video` : "";

  return (
    <main style={styles.page}>
      <div style={styles.glow} />
      <section style={styles.shell}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>AI LIVE VIDEO MAKER · KLING TEST</div>
            <h1 style={styles.title}>Make the singer actually sing.</h1>
            <p style={styles.subtitle}>
              Upload one singer image and a short vocal. Kling first creates a moving performance, then synchronizes the mouth to the uploaded singing audio.
            </p>
          </div>
          <a href="/" style={styles.back}>← Main workflow</a>
        </header>

        <form onSubmit={submit} style={styles.grid}>
          <div style={styles.card}>
            <label style={styles.label}>Singer image</label>
            <label htmlFor="singer-image" style={styles.drop}>
              <span style={styles.icon}>＋</span>
              <strong>{image ? image.name : "Choose JPG, PNG or WEBP"}</strong>
              <span style={styles.hint}>Use a clear front-facing face. Maximum 15 MB.</span>
            </label>
            <input id="singer-image" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectImage} style={styles.hidden} />
            {image && <img src={URL.createObjectURL(image)} alt="Singer preview" style={styles.preview} />}
          </div>

          <div style={styles.card}>
            <label style={styles.label}>Singing audio</label>
            <label htmlFor="singing-audio" style={styles.drop}>
              <span style={styles.icon}>♪</span>
              <strong>{audio ? audio.name : "Choose MP3, WAV, M4A or AAC"}</strong>
              <span style={styles.hint}>For this PoC: maximum 5 MB. The first 10 seconds are used.</span>
            </label>
            <input id="singing-audio" type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/*" onChange={selectAudio} style={styles.hidden} />
          </div>

          <div style={styles.actions}>
            <div>
              <strong>10-second singing-video PoC</strong>
              <div style={styles.hint}>9:16 · moving performer · Kling lip sync</div>
            </div>
            <button type="submit" disabled={!image || !audio || submitting} style={{ ...styles.button, ...(!image || !audio || submitting ? styles.disabled : {}) }}>
              {submitting ? "Starting…" : "Generate Singing Video →"}
            </button>
          </div>
        </form>

        {(status || error) && (
          <section style={styles.statusCard}>
            <div style={styles.statusTop}>
              <div>
                <div style={styles.eyebrow}>GENERATION STATUS</div>
                <h2 style={styles.statusTitle}>{status?.status === "completed" ? "Singing video ready" : status?.status === "failed" ? "Generation failed" : "Generating…"}</h2>
              </div>
              <div style={styles.phase}>{status?.phase || ""}</div>
            </div>
            <p style={styles.message}>{error || status?.error || status?.message || "Waiting for Kling…"}</p>
            {status?.status === "failed" && status.error && <pre style={styles.errorBox}>{status.error}</pre>}
            {videoUrl && (
              <div style={styles.videoWrap}>
                <video src={videoUrl} controls playsInline style={styles.video} />
                <a href={videoUrl} download="singing-test.mp4" style={styles.download}>Download MP4</a>
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#07111f", color: "#edf4ff", padding: "56px 24px", position: "relative", overflow: "hidden" },
  glow: { position: "absolute", width: 600, height: 600, borderRadius: "50%", background: "rgba(62, 123, 255, .13)", filter: "blur(80px)", top: -260, right: -180 },
  shell: { maxWidth: 1120, margin: "0 auto", position: "relative" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, marginBottom: 34 },
  eyebrow: { fontSize: 12, fontWeight: 800, letterSpacing: 2, color: "#7fa7d9", marginBottom: 10 },
  title: { fontSize: "clamp(34px, 5vw, 58px)", lineHeight: 1.02, margin: 0, maxWidth: 760 },
  subtitle: { color: "#9fb0c7", fontSize: 17, lineHeight: 1.6, maxWidth: 760, marginTop: 18 },
  back: { color: "#9fbff0", textDecoration: "none", whiteSpace: "nowrap", marginTop: 8 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 },
  card: { background: "rgba(13, 27, 45, .86)", border: "1px solid #1e3857", borderRadius: 18, padding: 24, minHeight: 250 },
  label: { display: "block", fontSize: 13, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: "#a9bdd7", marginBottom: 14 },
  drop: { border: "1px dashed #3b5d83", borderRadius: 14, minHeight: 130, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", textAlign: "center", padding: 20 },
  icon: { fontSize: 28, color: "#77a9ff" },
  hint: { color: "#7f92aa", fontSize: 13, lineHeight: 1.5 },
  hidden: { display: "none" },
  preview: { width: 110, height: 140, objectFit: "cover", borderRadius: 12, marginTop: 16, display: "block", marginLeft: "auto", marginRight: "auto" },
  actions: { gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, background: "#0d1b2d", border: "1px solid #1e3857", borderRadius: 18, padding: 22 },
  button: { border: 0, borderRadius: 12, padding: "14px 20px", background: "#4f8cff", color: "white", fontWeight: 800, cursor: "pointer", fontSize: 14 },
  disabled: { opacity: .45, cursor: "not-allowed" },
  statusCard: { marginTop: 22, background: "#0b1727", border: "1px solid #294664", borderRadius: 18, padding: 24 },
  statusTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20 },
  statusTitle: { margin: 0, fontSize: 28 },
  phase: { color: "#80b0ff", fontWeight: 800, textTransform: "uppercase", fontSize: 12, letterSpacing: 1 },
  message: { color: "#a7b8ce", lineHeight: 1.6 },
  errorBox: { whiteSpace: "pre-wrap", overflowX: "auto", background: "#160f15", border: "1px solid #5a2a3b", borderRadius: 12, padding: 16, color: "#ffb5c5" },
  videoWrap: { marginTop: 18, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 },
  video: { width: "min(420px, 100%)", maxHeight: "70vh", borderRadius: 14, background: "black" },
  download: { color: "#9fc2ff", fontWeight: 800, textDecoration: "none" },
};
