"use client";

import { ChangeEvent, type CSSProperties, useEffect, useRef, useState } from "react";

const backendUrl = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "").replace(/\/$/, "");

type Result = { id: string; status: string; message?: string; video_url?: string; error?: string | null };

export default function MotionTestPage() {
  const [image, setImage] = useState<File | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [job, setJob] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function base() {
    if (!backendUrl) throw new Error("NEXT_PUBLIC_BACKEND_URL is not configured.");
    return backendUrl;
  }

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (file && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Use JPG, PNG or WEBP."); setImage(null); return; }
    setError(""); setImage(file);
  }

  function selectAudio(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (file && !file.type.startsWith("audio/")) { setError("Use an MP3 or WAV file."); setAudio(null); return; }
    setError(""); setAudio(file);
  }

  async function start() {
    if (!image || !audio) { setError("Select one image and one audio file."); return; }
    setBusy(true); setError(""); setJob(null);
    try {
      const form = new FormData(); form.append("image", image, image.name); form.append("audio", audio, audio.name);
      const response = await fetch(`${base()}/motion-test`, { method: "POST", body: form });
      const data = (await response.json()) as Result & { detail?: string };
      if (!response.ok) throw new Error(data.detail || "Motion test could not be started.");
      setJob(data); poll(data.id);
    } catch (err) { setBusy(false); setError(err instanceof Error ? err.message : "Motion test failed."); }
  }

  async function poll(id: string) {
    try {
      const response = await fetch(`${base()}/motion-test/${id}`);
      const data = (await response.json()) as Result;
      setJob(data);
      if (data.status === "completed" || data.status === "failed") { setBusy(false); return; }
      timer.current = setTimeout(() => void poll(id), 1500);
    } catch { timer.current = setTimeout(() => void poll(id), 3000); }
  }

  const video = job?.video_url ? `${base()}${job.video_url}` : "";

  return (
    <main style={styles.page}>
      <section style={styles.shell}>
        <div style={styles.badge}>AI-FREE MOTION PROOF</div>
        <h1 style={styles.title}>Turn one still image into a moving music-video shot.</h1>
        <p style={styles.subtitle}>This is a 10-second proof of concept. No OpenAI key. No video-generation API. FFmpeg creates the camera movement on the Render service.</p>
        <div style={styles.grid}>
          <label style={styles.card}><span style={styles.label}>1. Still image</span><span style={styles.drop}>{image ? image.name : "Choose JPG, PNG or WEBP"}</span><span style={styles.hint}>Slow zoom + smooth pan motion.</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={selectImage} style={styles.input} /></label>
          <label style={styles.card}><span style={styles.label}>2. Music</span><span style={styles.drop}>{audio ? audio.name : "Choose MP3 or WAV"}</span><span style={styles.hint}>The first 10 seconds are used for this test.</span><input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/*" onChange={selectAudio} style={styles.input} /></label>
        </div>
        <button type="button" onClick={start} disabled={busy} style={styles.button}>{busy ? "Rendering motion test..." : "Create 10-second motion test →"}</button>
        {error && <div style={styles.error}>{error}</div>}
        {job && <div style={styles.result}>
          <div style={styles.statusRow}><strong>{job.status === "completed" ? "Motion test complete" : job.status === "failed" ? "Motion test failed" : "Rendering..."}</strong><span>{job.message}</span></div>
          {(job.status === "rendering" || job.status === "queued") && <div style={styles.loader}><div style={styles.loaderBar} /></div>}
          {job.status === "failed" && <pre style={styles.error}>{job.error}</pre>}
          {video && <div style={styles.videoWrap}><video src={video} controls playsInline style={styles.video} /><a href={video} target="_blank" rel="noreferrer" style={styles.link}>Open MP4</a></div>}
        </div>}
        <p style={styles.note}>If this looks good, the same motion engine can replace the current static-scene approach without adding a paid AI video API.</p>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: "100vh", background: "#07111f", color: "#eef5ff", padding: "56px 24px", fontFamily: "Inter, system-ui, sans-serif" },
  shell: { maxWidth: 980, margin: "0 auto" },
  badge: { display: "inline-block", fontSize: 12, letterSpacing: 2, fontWeight: 700, color: "#7dd3fc", marginBottom: 18 },
  title: { fontSize: "clamp(34px, 6vw, 64px)", lineHeight: 1.02, margin: 0, maxWidth: 850 },
  subtitle: { color: "#a7b7cc", fontSize: 17, lineHeight: 1.6, maxWidth: 760, margin: "22px 0 38px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 18 },
  card: { display: "flex", flexDirection: "column", gap: 12, padding: 24, border: "1px solid #20324a", borderRadius: 18, background: "#0c1929", cursor: "pointer" },
  label: { fontWeight: 700, fontSize: 14 },
  drop: { border: "1px dashed #3a526f", borderRadius: 12, padding: "28px 18px", color: "#dbeafe", minHeight: 28 },
  hint: { color: "#7f93ab", fontSize: 13 },
  input: { marginTop: 4 },
  button: { marginTop: 24, border: 0, borderRadius: 12, padding: "15px 22px", fontSize: 15, fontWeight: 800, cursor: "pointer", background: "#e2e8f0", color: "#07111f" },
  error: { marginTop: 18, padding: 16, borderRadius: 12, background: "#3a1720", color: "#fecaca", whiteSpace: "pre-wrap" },
  result: { marginTop: 30, padding: 24, border: "1px solid #20324a", borderRadius: 18, background: "#0c1929" },
  statusRow: { display: "flex", justifyContent: "space-between", gap: 16, color: "#a7b7cc", marginBottom: 16 },
  loader: { height: 6, background: "#182a40", borderRadius: 99, overflow: "hidden" },
  loaderBar: { height: "100%", width: "45%", background: "#7dd3fc" },
  videoWrap: { marginTop: 22, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12 },
  video: { width: "min(100%, 420px)", maxHeight: "70vh", borderRadius: 14, background: "#000" },
  link: { color: "#7dd3fc", fontWeight: 700 },
  note: { marginTop: 28, color: "#71839a", fontSize: 13, lineHeight: 1.5 },
};
