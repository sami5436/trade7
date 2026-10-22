import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

export const alt = "TRADE7 Momentum Trading Terminal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const [bold, medium] = await Promise.all([
    readFile(path.join(process.cwd(), "src/assets/geist-800.ttf")),
    readFile(path.join(process.cwd(), "src/assets/geist-500.ttf")),
  ]);
  const pill = (label: string, filled: boolean) => (
    <div
      style={{
        display: "flex",
        padding: "14px 30px",
        borderRadius: 999,
        border: "2px solid #fff",
        background: filled ? "#fff" : "#000",
        color: filled ? "#000" : "#fff",
        fontSize: 28,
        fontWeight: 800,
        letterSpacing: 2,
      }}
    >
      {label}
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#000", color: "#fff", padding: 80, fontFamily: "Geist" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", width: 64, height: 64, borderRadius: 16, border: "3px solid #fff", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 800 }}>T7</div>
          <div style={{ display: "flex", fontSize: 28, fontWeight: 500, color: "#8a8a8a", letterSpacing: 4 }}>PAPER TRADING</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 196, fontWeight: 800, letterSpacing: -8, lineHeight: 1 }}>TRADE7</div>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 500, color: "#a3a3a3", marginTop: 24 }}>Momentum Trading Terminal</div>
        </div>
        <div style={{ display: "flex", gap: 18 }}>
          {pill("BUY", true)}
          {pill("SELL", false)}
          {pill("WAIT", false)}
          {pill("EXIT", false)}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: bold, weight: 800, style: "normal" },
        { name: "Geist", data: medium, weight: 500, style: "normal" },
      ],
    },
  );
}
