"use client";

import { FormEvent, type CSSProperties, useEffect, useMemo, useRef, useState } from "react";

const backendUrl = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "").replace(/\/$/, "");

type JobStatus = { id: string; status: string; phase: string; message?: string; video_url?: string; error?: string | null };
type ApiError = { detail?: string };
type StepKey = "upload" | "motion" | "lipsync" | "final";

const steps: Array<{ key: StepKey; title: string; detail: string }> = [
  { key: "upload", title: "Source prepared", detail: "Singer image and vocal are uploaded." },
  { key: "motion", title: "Performance generated", detail: "Kling creates natural performer motion." },
  { key: "lipsync", title: "Lip sync", detail: "The mouth is synchronized to the singing." },
  { key: "final", title: "Video ready", detail: "The finished singing performance is available." },
];

function phaseIndex(status: JobStatus | null): number {
  if (!status) return -1;
  if (status.status === "completed") return 3;
  if (status.status === "failed") return -1;
  const phase = (status.phase || "").toLowerCase();
  if (phase.includes("lip") || phase.includes("sync")) return 2;
  if (phase.includes("video") || phase.includes("motion") || phase.includes("animate")) return 1;
  return 0;
}

export default function HomePage() {
  const [image, setImage] = useState<File | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [jobId, setJobId] = useState("");
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState<"image" | "audio" | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);
  const imagePreview = useMemo(() => (image ? URL.createObjectURL(image) : ""), [image]);
  useEffect(() => () => { if (imagePreview) URL.revokeObjectURL(imagePreview); }, [imagePreview]);

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

  function acceptImage(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Please choose a JPG, PNG or WEBP image.");
    if (file.size > 15 * 1024 * 1024) return setError("Singer images must be 15 MB or smaller.");
    setImage(file); setError("");
  }

  function acceptAudio(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("audio/")) return setError("Please choose an audio file.");
    if (file.size > 50 * 1024 * 1024) return setError("Singing audio must be 50 MB or smaller.");
    setAudio(file); setError("");
  }

  function handleDrop(kind: "image" | "audio", event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault(); setDragOver(null);
    const file = event.dataTransfer.files?.[0] ?? null;
    kind === "image" ? acceptImage(file) : acceptAudio(file);
  }

  async function poll(id: string) {
    try {
      const data = await request<JobStatus>(`/singing-test/${id}`);
      setStatus(data);
      if (data.status === "completed" || data.status === "failed") return;
      pollRef.current = setTimeout(() => void poll(id), 3000);
    } catch (pollError) {
      setError(pollError instanceof Error ? pollError.message : "Status check failed.");
      pollRef.current = setTimeout(() => void poll(id), 5000);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!image || !audio || submitting) return;
    setError(""); setStatus(null); setJobId(""); setSubmitting(true);
    try {
      const form = new FormData();
      form.append("image", image, image.name); form.append("audio", audio, audio.name);
      const created = await request<JobStatus>("/singing-test", { method: "POST", body: form });
      setJobId(created.id); setStatus(created); await poll(created.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Singing video generation failed.");
    } finally { setSubmitting(false); }
  }

  const videoUrl = status?.status === "completed" && jobId ? `${backendUrl}/singing-test/${jobId}/video` : "";
  const currentStep = phaseIndex(status);
  const isRunning = Boolean(status && status.status !== "completed" && status.status !== "failed");
  const balanceError = /balance not enough|account balance/i.test(error || status?.error || "");

  return (
    <main style={styles.page}>
      <div style={styles.ambientOne} /><div style={styles.ambientTwo} />
      <section style={styles.shell}>
        <header style={styles.header}>
          <div>
            <div style={styles.brand}>AI LIVE VIDEO MAKER</div>
            <div style={styles.productLine}><span style={styles.liveDot} /> SINGING PERFORMANCE STUDIO</div>
            <h1 style={styles.title}>Make the singer<br />actually sing.</h1>
            <p style={styles.subtitle}>Give us a singer image and the vocal track. The production pipeline creates performer motion first, then synchronizes the mouth to the actual singing.</p>
          </div>
          <div style={styles.badge}>KLING POWERED</div>
        </header>

        <form onSubmit={submit}>
          <div style={styles.uploadGrid}>
            <label htmlFor="singer-image" style={{ ...styles.uploadCard, ...(dragOver === "image" ? styles.uploadActive : {}) }} onDragOver={(e) => { e.preventDefault(); setDragOver("image"); }} onDragLeave={() => setDragOver(null)} onDrop={(e) => handleDrop("image", e)}>
              <input id="singer-image" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => acceptImage(e.target.files?.[0] ?? null)} style={styles.hidden} disabled={submitting} />
              <div style={styles.cardTop}><span style={styles.number}>01</span><span style={styles.cardLabel}>SINGER IMAGE</span></div>
              {imagePreview ? <div style={styles.imageSelected}><img src={imagePreview} alt="Singer preview" style={styles.imagePreview} /><div style={styles.selectedInfo}><strong>{image?.name ?? "Selected image"}</strong><span>Image ready</span></div></div> : <div style={styles.emptyUpload}><div style={styles.uploadIcon}>+</div><strong>Drop a singer image here</strong><span>or click to browse · JPG / PNG / WEBP · max 15 MB</span></div>}
            </label>

            <label htmlFor="singing-audio" style={{ ...styles.uploadCard, ...(dragOver === "audio" ? styles.uploadActive : {}) }} onDragOver={(e) => { e.preventDefault(); setDragOver("audio"); }} onDragLeave={() => setDragOver(null)} onDrop={(e) => handleDrop("audio", e)}>
              <input id="singing-audio" type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/*" onChange={(e) => acceptAudio(e.target.files?.[0] ?? null)} style={styles.hidden} disabled={submitting} />
              <div style={styles.cardTop}><span style={styles.number}>02</span><span style={styles.cardLabel}>SINGING AUDIO</span></div>
              {audio ? <div style={styles.audioSelected}><div style={styles.audioIcon}>♪</div><div style={styles.selectedInfo}><strong>{audio?.name ?? "Selected audio"}</strong><span>Vocal track ready</span></div></div> : <div style={styles.emptyUpload}><div style={styles.audioBig}>♪</div><strong>Drop the vocal track here</strong><span>or click to browse · MP3 / WAV / M4A / AAC · max 50 MB</span></div>}
            </label>
          </div>

          <div style={styles.controlBar}>
            <div><div style={styles.controlTitle}>10-second performance proof of concept</div><div style={styles.controlHint}>9:16 vertical · moving performer · synchronized singing</div></div>
            <button type="submit" disabled={!image || !audio || submitting} style={{ ...styles.primary, ...(!image || !audio || submitting ? styles.primaryDisabled : {}) }}>{submitting ? "Starting performance…" : "Create Singing Video"}<span style={styles.arrow}>→</span></button>
          </div>
        </form>

        {(status || error) && <section style={styles.generation} role="status">
          <div style={styles.generationHeader}><div><div style={styles.sectionEyebrow}>LIVE GENERATION</div><h2 style={styles.generationTitle}>{status?.status === "completed" ? "Performance ready." : status?.status === "failed" ? "Generation stopped." : "Building the performance…"}</h2></div>{status?.phase && <div style={styles.phasePill}>{status.phase.replaceAll("_", " ")}</div>}</div>
          <div style={styles.timeline}>{steps.map((step, index) => { const done = status?.status === "completed" || currentStep > index; const active = isRunning && currentStep === index; return <div key={step.key} style={styles.timelineItem}><div style={{ ...styles.timelineMark, ...(done ? styles.timelineDone : {}), ...(active ? styles.timelineActive : {}) }}>{done ? "✓" : index + 1}</div><div style={styles.timelineText}><strong>{step.title}</strong><span>{active ? (status?.message || step.detail) : step.detail}</span></div></div>; })}</div>
          {status?.status === "failed" && (status.error || error) && <div style={{ ...styles.errorPanel, ...(balanceError ? styles.balancePanel : {}) }}><strong>{balanceError ? "Kling API balance required" : "Generation error"}</strong><div>{status.error || error}</div>{balanceError && <span style={styles.errorHint}>The application reached Kling successfully. Add API credits to the Kling account and run the same test again.</span>}</div>}
          {error && !status?.error && status?.status !== "failed" && <div style={styles.errorPanel}><strong>Connection error</strong><div>{error}</div></div>}
          {videoUrl && <div style={styles.result}><div style={styles.resultHeader}><div><div style={styles.sectionEyebrow}>FINAL OUTPUT</div><strong style={styles.resultTitle}>Singing performance</strong></div><a href={videoUrl} download="singing-performance.mp4" style={styles.download}>Download MP4 ↓</a></div><video src={videoUrl} controls playsInline style={styles.video} /></div>}
        </section>}

        <footer style={styles.footer}><span>IMAGE → MOTION → LIP SYNC → VIDEO</span><span>10s PoC</span></footer>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: "100vh", background: "#060b12", color: "#f1f5f9", padding: "48px 24px 30px", position: "relative", overflow: "hidden", fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif" },
  ambientOne: { position: "fixed", width: 520, height: 520, borderRadius: "50%", background: "rgba(41, 105, 214, .14)", filter: "blur(110px)", top: -260, right: -160, pointerEvents: "none" },
  ambientTwo: { position: "fixed", width: 440, height: 440, borderRadius: "50%", background: "rgba(30, 190, 160, .06)", filter: "blur(120px)", bottom: -250, left: -160, pointerEvents: "none" },
  shell: { maxWidth: 1180, margin: "0 auto", position: "relative" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 30, marginBottom: 38 },
  brand: { fontSize: 12, fontWeight: 900, letterSpacing: 2.4, color: "#8ca4c2", marginBottom: 12 },
  productLine: { display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 800, letterSpacing: 1.6, color: "#5ee0c1", marginBottom: 16 },
  liveDot: { width: 7, height: 7, borderRadius: "50%", background: "#5ee0c1", boxShadow: "0 0 14px rgba(94,224,193,.65)" },
  title: { fontSize: "clamp(42px, 6vw, 74px)", lineHeight: .96, letterSpacing: -2.8, margin: 0, maxWidth: 820, fontWeight: 850 },
  subtitle: { color: "#8799ae", fontSize: 16, lineHeight: 1.65, maxWidth: 720, margin: "20px 0 0" },
  badge: { border: "1px solid #28425d", color: "#9cb6d2", borderRadius: 999, padding: "9px 13px", fontSize: 10, fontWeight: 900, letterSpacing: 1.3, whiteSpace: "nowrap" },
  uploadGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 },
  uploadCard: { minHeight: 290, background: "rgba(12, 21, 33, .88)", border: "1px solid #20354c", borderRadius: 20, padding: 24, display: "flex", flexDirection: "column", cursor: "pointer" },
  uploadActive: { borderColor: "#4f8cff", background: "rgba(18, 36, 58, .96)" },
  hidden: { display: "none" },
  cardTop: { display: "flex", alignItems: "center", gap: 10, marginBottom: 20 },
  number: { color: "#55708f", fontSize: 11, fontWeight: 900, letterSpacing: 1 },
  cardLabel: { color: "#a9bbcf", fontSize: 11, fontWeight: 900, letterSpacing: 1.5 },
  emptyUpload: { flex: 1, border: "1px dashed #36506c", borderRadius: 15, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, textAlign: "center", color: "#cbd6e2" },
  uploadIcon: { width: 42, height: 42, borderRadius: "50%", display: "grid", placeItems: "center", background: "#14263a", color: "#75a7ff", fontSize: 27, fontWeight: 300 },
  audioBig: { width: 42, height: 42, borderRadius: "50%", display: "grid", placeItems: "center", background: "#14263a", color: "#5ee0c1", fontSize: 22 },
  imageSelected: { flex: 1, borderRadius: 15, background: "#0a1420", border: "1px solid #28435d", display: "flex", alignItems: "center", justifyContent: "center", gap: 20, padding: 18 },
  imagePreview: { width: 112, height: 155, objectFit: "cover", borderRadius: 12 },
  audioSelected: { flex: 1, borderRadius: 15, background: "#0a1420", border: "1px solid #28435d", display: "flex", alignItems: "center", gap: 16, padding: 24 },
  audioIcon: { width: 54, height: 54, borderRadius: "50%", display: "grid", placeItems: "center", background: "#14263a", color: "#5ee0c1", fontSize: 26 },
  selectedInfo: { display: "flex", flexDirection: "column", gap: 7, minWidth: 0 },
  emptyUpload: { flex: 1, border: "1px dashed #36506c", borderRadius: 15, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, textAlign: "center", color: "#cbd6e2" },
  controlBar: { marginTop: 18, border: "1px solid #20354c", background: "rgba(12,21,33,.75)", borderRadius: 18, padding: 18, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20 },
  controlTitle: { fontWeight: 800, color: "#dce7f2", fontSize: 14 },
  controlHint: { color: "#6f849b", fontSize: 12, marginTop: 6 },
  primary: { border: 0, borderRadius: 12, padding: "15px 20px", background: "#4f8cff", color: "white", fontWeight: 900, cursor: "pointer", display: "flex", gap: 20, alignItems: "center", fontSize: 13 },
  primaryDisabled: { opacity: .45, cursor: "not-allowed" },
  arrow: { fontSize: 20 },
  generation: { marginTop: 24, border: "1px solid #20354c", background: "rgba(10,18,28,.9)", borderRadius: 20, padding: 24 },
  generationHeader: { display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start" },
  sectionEyebrow: { color: "#5ee0c1", fontSize: 10, fontWeight: 900, letterSpacing: 1.8 },
  generationTitle: { margin: "8px 0 0", fontSize: 26 },
  phasePill: { border: "1px solid #28425d", borderRadius: 999, padding: "8px 12px", color: "#a9bbcf", fontSize: 11, textTransform: "capitalize" },
  timeline: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginTop: 24 },
  timelineItem: { display: "flex", gap: 10, minWidth: 0 },
  timelineMark: { flex: "0 0 auto", width: 28, height: 28, borderRadius: "50%", display: "grid", placeItems: "center", border: "1px solid #36506c", color: "#71869c", fontSize: 11, fontWeight: 900 },
  timelineDone: { background: "#163c35", borderColor: "#2c7b6c", color: "#5ee0c1" },
  timelineActive: { borderColor: "#4f8cff", color: "#75a7ff", boxShadow: "0 0 0 4px rgba(79,140,255,.08)" },
  timelineText: { display: "flex", flexDirection: "column", gap: 5 },
  errorPanel: { marginTop: 22, padding: 16, borderRadius: 12, border: "1px solid #713b45", background: "rgba(82,25,35,.25)", color: "#f1c7cf", display: "flex", flexDirection: "column", gap: 8 },
  balancePanel: { borderColor: "#725d2f", background: "rgba(91,67,20,.22)" },
  errorHint: { color: "#b7a982", fontSize: 12 },
  result: { marginTop: 24 },
  resultHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, marginBottom: 12 },
  resultTitle: { display: "block", marginTop: 6 },
  download: { color: "#9dc0ff", textDecoration: "none", fontSize: 12, fontWeight: 800 },
  video: { width: "100%", maxHeight: "72vh", background: "#000", borderRadius: 14, display: "block" },
  footer: { display: "flex", justifyContent: "space-between", color: "#4e6379", fontSize: 10, letterSpacing: 1.4, fontWeight: 800, marginTop: 30 },
};
