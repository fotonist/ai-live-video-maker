"use client";

import { ChangeEvent, FormEvent, type CSSProperties, useEffect, useMemo, useRef, useState } from "react";

const backendUrl = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "").replace(/\/$/, "");

type JobStatus = {
  id: string;
  status: string;
  phase: string;
  message?: string;
  video_url?: string;
  error?: string | null;
};

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

  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  const imagePreview = useMemo(() => (image ? URL.createObjectURL(image) : ""), [image]);

  useEffect(() => () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

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
    if (!file.type.startsWith("image/")) {
      setError("Please choose a JPG, PNG or WEBP image.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("Singer images must be 15 MB or smaller.");
      return;
    }
    setImage(file);
    setError("");
  }

  function acceptAudio(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setError("Please choose an audio file.");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError("Singing audio must be 50 MB or smaller.");
      return;
    }
    setAudio(file);
    setError("");
  }

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    acceptImage(event.target.files?.[0] ?? null);
  }

  function selectAudio(event: ChangeEvent<HTMLInputElement>) {
    acceptAudio(event.target.files?.[0] ?? null);
  }

  function handleDrop(kind: "image" | "audio", event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragOver(null);
    const file = event.dataTransfer.files?.[0] ?? null;
    if (kind === "image") acceptImage(file);
    else acceptAudio(file);
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

    setError("");
    setStatus(null);
    setJobId("");
    setSubmitting(true);

    try {
      const form = new FormData();
      form.append("image", image, image.name);
      form.append("audio", audio, audio.name);
      const created = await request<JobStatus>("/singing-test", { method: "POST", body: form });
      setJobId(created.id);
      setStatus(created);
      await poll(created.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Singing video generation failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const videoUrl = status?.status === "completed" && jobId ? `${backendUrl}/singing-test/${jobId}/video` : "";
  const currentStep = phaseIndex(status);
  const isRunning = Boolean(status && status.status !== "completed" && status.status !== "failed");
  const balanceError = /balance not enough|account balance/i.test(error || status?.error || "");

  return (
    <main style={styles.page}>
      <div style={styles.ambientOne} />
      <div style={styles.ambientTwo} />

      <section style={styles.shell}>
        <header style={styles.header}>
          <div>
            <div style={styles.brand}>AI LIVE VIDEO MAKER</div>
            <div style={styles.productLine}>
              <span style={styles.liveDot} />
              SINGING PERFORMANCE STUDIO
            </div>
            <h1 style={styles.title}>Make the singer<br />actually sing.</h1>
            <p style={styles.subtitle}>
              Give us a singer image and the vocal track. The production pipeline creates performer motion first, then synchronizes the mouth to the actual singing.
            </p>
          </div>
          <div style={styles.badge}>KLING POWERED</div>
        </header>

        <form onSubmit={submit}>
          <div style={styles.uploadGrid}>
            <label
              htmlFor="singer-image"
              style={{ ...styles.uploadCard, ...(dragOver === "image" ? styles.uploadActive : {}) }}
              onDragOver={(event) => { event.preventDefault(); setDragOver("image"); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(event) => handleDrop("image", event)}
            >
              <input id="singer-image" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectImage} style={styles.hidden} disabled={submitting} />
              <div style={styles.cardTop}>
                <span style={styles.number}>01</span>
                <span style={styles.cardLabel}>SINGER IMAGE</span>
              </div>
              {imagePreview ? (
                <div style={styles.imageSelected}>
                  <img src={imagePreview} alt="Singer preview" style={styles.imagePreview} />
                  <div style={styles.selectedInfo}>
                    <strong>{image.name}</strong>
                    <span>Image ready</span>
                  </div>
                </div>
              ) : (
                <div style={styles.emptyUpload}>
                  <div style={styles.uploadIcon}>+</div>
                  <strong>Drop a singer image here</strong>
                  <span>or click to browse · JPG / PNG / WEBP · max 15 MB</span>
                </div>
              )}
            </label>

            <label
              htmlFor="singing-audio"
              style={{ ...styles.uploadCard, ...(dragOver === "audio" ? styles.uploadActive : {}) }}
              onDragOver={(event) => { event.preventDefault(); setDragOver("audio"); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(event) => handleDrop("audio", event)}
            >
              <input id="singing-audio" type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/*" onChange={selectAudio} style={styles.hidden} disabled={submitting} />
              <div style={styles.cardTop}>
                <span style={styles.number}>02</span>
                <span style={styles.cardLabel}>SINGING AUDIO</span>
              </div>
              {audio ? (
                <div style={styles.audioSelected}>
                  <div style={styles.audioIcon}>♪</div>
                  <div style={styles.selectedInfo}>
                    <strong>{audio.name}</strong>
                    <span>Vocal track ready</span>
                  </div>
                </div>
              ) : (
                <div style={styles.emptyUpload}>
                  <div style={styles.audioBig}>♪</div>
                  <strong>Drop the vocal track here</strong>
                  <span>or click to browse · MP3 / WAV / M4A / AAC · max 50 MB</span>
                </div>
              )}
            </label>
          </div>

          <div style={styles.controlBar}>
            <div>
              <div style={styles.controlTitle}>10-second performance proof of concept</div>
              <div style={styles.controlHint}>9:16 vertical · moving performer · synchronized singing</div>
            </div>
            <button type="submit" disabled={!image || !audio || submitting} style={{ ...styles.primary, ...(!image || !audio || submitting ? styles.primaryDisabled : {}) }}>
              {submitting ? "Starting performance…" : "Create Singing Video"}
              <span style={styles.arrow}>→</span>
            </button>
          </div>
        </form>

        {(status || error) && (
          <section style={styles.generation} role="status">
            <div style={styles.generationHeader}>
              <div>
                <div style={styles.sectionEyebrow}>LIVE GENERATION</div>
                <h2 style={styles.generationTitle}>
                  {status?.status === "completed" ? "Performance ready." : status?.status === "failed" ? "Generation stopped." : "Building the performance…"}
                </h2>
              </div>
              {status?.phase && <div style={styles.phasePill}>{status.phase.replaceAll("_", " ")}</div>}
            </div>

            <div style={styles.timeline}>
              {steps.map((step, index) => {
                const done = status?.status === "completed" || currentStep > index;
                const active = isRunning && currentStep === index;
                return (
                  <div key={step.key} style={styles.timelineItem}>
                    <div style={{ ...styles.timelineMark, ...(done ? styles.timelineDone : {}), ...(active ? styles.timelineActive : {}) }}>
                      {done ? "✓" : index + 1}
                    </div>
                    <div style={styles.timelineText}>
                      <strong>{step.title}</strong>
                      <span>{active ? (status?.message || step.detail) : step.detail}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {status?.status === "failed" && (status.error || error) && (
              <div style={{ ...styles.errorPanel, ...(balanceError ? styles.balancePanel : {}) }}>
                <strong>{balanceError ? "Kling API balance required" : "Generation error"}</strong>
                <div>{status.error || error}</div>
                {balanceError && <span style={styles.errorHint}>The application reached Kling successfully. Add API credits to the Kling account and run the same test again.</span>}
              </div>
            )}

            {error && !status?.error && status?.status !== "failed" && <div style={styles.errorPanel}><strong>Connection error</strong><div>{error}</div></div>}

            {videoUrl && (
              <div style={styles.result}>
                <div style={styles.resultHeader}>
                  <div>
                    <div style={styles.sectionEyebrow}>FINAL OUTPUT</div>
                    <strong style={styles.resultTitle}>Singing performance</strong>
                  </div>
                  <a href={videoUrl} download="singing-performance.mp4" style={styles.download}>Download MP4 ↓</a>
                </div>
                <video src={videoUrl} controls playsInline style={styles.video} />
              </div>
            )}
          </section>
        )}

        <footer style={styles.footer}>
          <span>IMAGE → MOTION → LIP SYNC → VIDEO</span>
          <span>10s PoC</span>
        </footer>
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
  uploadCard: { minHeight: 290, background: "rgba(12, 21, 33, .88)", border: "1px solid #20354c", borderRadius: 20, padding: 24, display: "flex", flexDirection: "column", cursor: "pointer", transition: "border-color .2s, background .2s" },
  uploadActive: { borderColor: "#4f8cff", background: "rgba(18, 36, 58, .96)" },
  hidden: { display: "none" },
  cardTop: { display: "flex", alignItems: "center", gap: 10, marginBottom: 20 },
  number: { color: "#55708f", fontSize: 11, fontWeight: 900, letterSpacing: 1 },
  cardLabel: { color: "#a9bbcf", fontSize: 11, fontWeight: 900, letterSpacing: 1.5 },
  emptyUpload: { flex: 1, border: "1px dashed #36506c", borderRadius: 15, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, textAlign: "center", color: "#cbd6e2" },
  uploadIcon: { width: 42, height: 42, borderRadius: "50%", display: "grid", placeItems: "center", background: "#14263a", color: "#75a7ff", fontSize: 27, fontWeight: 300 },
  audioBig: { width: 42, height: 42, borderRadius: "50%", display: "grid", placeItems: "center", background: "#14263a", color: "#5ee0c1", fontSize: 22 },
  emptyUpload: { flex: 1, border: "1px dashed #36506c", borderRadius: 15, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, textAlign: "center", color: "#cbd6e2" },
  imageSelected: { flex: 1, borderRadius: 15, background: "#0a1420", border: "1px solid #28435d", display: "flex", alignItems: "center", justifyContent: "center", gap: 20, padding: 18 },
  imagePreview: { width: 112, height: 155, objectFit: "cover", borderRadius: 12, border: "1px solid #36516c" },
  selectedInfo: { display: "flex", flexDirection: "column", gap: 7, maxWidth: 230, overflow: "hidden" },
  audioSelected: { flex: 1, borderRadius: 15, background: "#0a1420", border: "1px solid #28435d", display: "flex", alignItems: "center", justifyContent: "center", gap: 18, padding: 25 },
  audioIcon: { width: 64, height: 64, borderRadius: "50%", display: "grid", placeItems: "center", background: "#12312f", color: "#5ee0c1", fontSize: 31 },
  controlBar: { marginTop: 18, background: "#0b1725", border: "1px solid #20384f", borderRadius: 18, padding: 18, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 22 },
  controlTitle: { fontWeight: 800, fontSize: 14, marginBottom: 5 },
  controlHint: { color: "#71859c", fontSize: 12 },
  primary: { border: 0, borderRadius: 12, background: "#4f8cff", color: "white", padding: "15px 21px", fontWeight: 900, fontSize: 14, cursor: "pointer", boxShadow: "0 8px 30px rgba(79,140,255,.18)", whiteSpace: "nowrap" },
  primaryDisabled: { opacity: .42, cursor: "not-allowed", boxShadow: "none" },
  arrow: { marginLeft: 12, fontSize: 18 },
  generation: { marginTop: 24, background: "#09131f", border: "1px solid #20384f", borderRadius: 20, padding: 24 },
  generationHeader: { display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start", marginBottom: 25 },
  sectionEyebrow: { fontSize: 10, fontWeight: 900, letterSpacing: 1.8, color: "#6785a4", marginBottom: 7 },
  generationTitle: { margin: 0, fontSize: 28, letterSpacing: -.7 },
  phasePill: { border: "1px solid #294764", color: "#7faeff", borderRadius: 999, padding: "8px 11px", fontSize: 10, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase" },
  timeline: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, position: "relative" },
  timelineItem: { position: "relative", display: "flex", gap: 12, paddingRight: 16, minHeight: 74 },
  timelineMark: { flex: "0 0 28px", width: 28, height: 28, borderRadius: "50%", border: "1px solid #2a435d", display: "grid", placeItems: "center", color: "#607991", fontSize: 11, fontWeight: 900, background: "#0a1521", position: "relative", zIndex: 1 },
  timelineDone: { background: "#12312e", borderColor: "#347c70", color: "#5ee0c1" },
  timelineActive: { background: "#162e50", borderColor: "#4f8cff", color: "#83b0ff", boxShadow: "0 0 0 5px rgba(79,140,255,.08)" },
  timelineText: { display: "flex", flexDirection: "column", gap: 5 },
  result: { marginTop: 26, borderTop: "1px solid #1b3146", paddingTop: 22 },
  resultHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 20, marginBottom: 15 },
  resultTitle: { fontSize: 18 },
  download: { color: "#8db7ff", textDecoration: "none", fontWeight: 800, fontSize: 12 },
  video: { display: "block", width: "min(430px, 100%)", maxHeight: "72vh", margin: "0 auto", borderRadius: 15, background: "#000", border: "1px solid #253c54" },
  errorPanel: { marginTop: 18, border: "1px solid #693847", background: "#1b1015", color: "#ffbdca", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 8, lineHeight: 1.5, fontSize: 13 },
  balancePanel: { borderColor: "#6d5533", background: "#1b160f", color: "#f2cf94" },
  errorHint: { color: "#b9a27d", fontSize: 12 },
  footer: { marginTop: 26, display: "flex", justifyContent: "space-between", color: "#4f647a", fontSize: 10, fontWeight: 900, letterSpacing: 1.3 },
};
