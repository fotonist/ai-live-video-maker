"use client";

import { ChangeEvent, FormEvent, useState } from "react";

export default function HomePage() {
  const [projectName, setProjectName] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [format, setFormat] = useState("9:16");
  const [singer, setSinger] = useState("Female");
  const [submitted, setSubmitted] = useState(false);

  function handleAudioChange(event: ChangeEvent<HTMLInputElement>) {
    setAudioFile(event.target.files?.[0] ?? null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <main style={styles.page}>
      <div style={styles.backgroundGlow} />

      <section style={styles.shell}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>AI LIVE VIDEO MAKER</div>
            <h1 style={styles.title}>Turn a song into a live performance.</h1>
            <p style={styles.subtitle}>
              Upload your music and lyrics. Build the first version of your AI-generated concert video.
            </p>
          </div>
          <div style={styles.status}>Prototype</div>
        </header>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.card}>
            <label style={styles.label} htmlFor="project-name">
              Project name
            </label>
            <input
              id="project-name"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="My Concert Video"
              style={styles.input}
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
              onChange={(event) => setLyrics(event.target.value)}
              placeholder="Paste your song lyrics here..."
              style={styles.textarea}
              rows={9}
              required
            />
            <div style={styles.helper}>{lyrics.length} characters</div>
          </div>

          <div style={styles.grid}>
            <div style={styles.card}>
              <label style={styles.label} htmlFor="audio">
                Music
              </label>
              <label htmlFor="audio" style={styles.uploadBox}>
                <span style={styles.uploadIcon}>↑</span>
                <strong>{audioFile ? audioFile.name : "Upload MP3 or WAV"}</strong>
                <span style={styles.helper}>Maximum file size will be enforced by the backend.</span>
              </label>
              <input
                id="audio"
                type="file"
                accept="audio/mpeg,audio/wav,audio/x-wav,audio/*"
                onChange={handleAudioChange}
                style={styles.hiddenInput}
                required
              />
            </div>

            <div style={styles.card}>
              <label style={styles.label}>Output format</label>
              <div style={styles.optionRow}>
                {["9:16", "16:9"].map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setFormat(option)}
                    style={{ ...styles.option, ...(format === option ? styles.optionActive : {}) }}
                  >
                    {option}
                  </button>
                ))}
              </div>

              <label style={{ ...styles.label, marginTop: 24 }}>Singer</label>
              <div style={styles.optionRow}>
                {["Female", "Male"].map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSinger(option)}
                    style={{ ...styles.option, ...(singer === option ? styles.optionActive : {}) }}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={styles.footer}>
            <div>
              <div style={styles.footerTitle}>Ready to create</div>
              <div style={styles.helper}>The generation pipeline will be connected next.</div>
            </div>
            <button type="submit" style={styles.primaryButton}>
              Create Project <span>→</span>
            </button>
          </div>
        </form>

        {submitted && (
          <div style={styles.success} role="status">
            <strong>Project draft ready.</strong> Your selected format is {format} and the singer is {singer}.
            The next step is connecting this form to the Project API.
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
    background: "radial-gradient(circle, rgba(105, 80, 255, 0.20), transparent 68%)",
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
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
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
};
