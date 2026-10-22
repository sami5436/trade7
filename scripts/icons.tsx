// Generates the app icons, favicon and touch icons from one monochrome mark.
import { readFileSync, writeFileSync } from "node:fs";
import { ImageResponse } from "next/og";

function Mark({ size, pad }: { size: number; pad: number }) {
  const inner = size - pad * 2;
  return (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#000" }}>
      <div
        style={{
          width: inner,
          height: inner,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000",
          color: "#fff",
          fontFamily: "Geist",
          fontSize: inner * 0.62,
          fontWeight: 800,
          letterSpacing: -inner * 0.04,
          border: pad > 0 ? `${Math.max(2, inner * 0.035)}px solid #fff` : "none",
          borderRadius: inner * 0.22,
        }}
      >
        T7
      </div>
    </div>
  );
}

async function png(size: number, pad: number) {
  const res = new ImageResponse(<Mark size={size} pad={pad} />, {
    width: size,
    height: size,
    fonts: [{ name: "Geist", data: readFileSync("src/assets/geist-800.ttf"), weight: 800, style: "normal" }],
  });
  return Buffer.from(await res.arrayBuffer());
}

function ico(images: { size: number; data: Buffer }[]) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((img, i) => {
    const o = 6 + i * 16;
    header.writeUInt8(img.size >= 256 ? 0 : img.size, o);
    header.writeUInt8(img.size >= 256 ? 0 : img.size, o + 1);
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(img.data.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += img.data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

const out = async () => {
  writeFileSync("public/icons/icon-192.png", await png(192, 0));
  writeFileSync("public/icons/icon-512.png", await png(512, 0));
  writeFileSync("public/icons/maskable-512.png", await png(512, 96));
  writeFileSync("src/app/icon.png", await png(512, 0));
  writeFileSync("src/app/apple-icon.png", await png(180, 0));
  writeFileSync("src/app/favicon.ico", ico([{ size: 16, data: await png(16, 0) }, { size: 32, data: await png(32, 0) }, { size: 48, data: await png(48, 0) }]));
  console.log("icons written");
};
out();
