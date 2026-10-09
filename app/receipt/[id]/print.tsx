"use client";
export default function Print() {
  return (
    <div
      className="no-print"
      style={{ marginTop: 30, display: "flex", gap: 20 }}
    >
      <button onClick={() => window.print()}>Print / save PDF</button>
      <a href="/">Back to workspace</a>
    </div>
  );
}
