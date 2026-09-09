// Generates iOS launch images (apple-touch-startup-image) for the PWA.
// Without these iOS shows a blank white screen while the app boots, which is
// the single biggest "this is a website" tell. Run: node scripts/gen-splash.mjs
import sharp from "sharp";
import { mkdir } from "fs/promises";

const OUT = "public/splash";
const LIGHT = { bg: "#fffaf0", name: "light" };
const DARK = { bg: "#0c1a22", name: "dark" };

// width x height in CSS px @ dpr — covers iPhone SE → 16 Pro Max.
// Portrait only (the manifest locks orientation to portrait).
const DEVICES = [
  { w: 320, h: 568, r: 2 },  // SE 1st
  { w: 375, h: 667, r: 2 },  // SE 2/3, 8
  { w: 414, h: 736, r: 3 },  // 8 Plus
  { w: 375, h: 812, r: 3 },  // X, XS, 11 Pro, 12/13 mini
  { w: 414, h: 896, r: 2 },  // XR, 11
  { w: 414, h: 896, r: 3 },  // XS Max, 11 Pro Max
  { w: 390, h: 844, r: 3 },  // 12, 13, 14
  { w: 428, h: 926, r: 3 },  // 12/13 Pro Max, 14 Plus
  { w: 393, h: 852, r: 3 },  // 14 Pro, 15, 16
  { w: 430, h: 932, r: 3 },  // 14 Pro Max, 15 Plus/Pro Max
  { w: 402, h: 874, r: 3 },  // 16 Pro
  { w: 440, h: 956, r: 3 },  // 16 Pro Max
];

await mkdir(OUT, { recursive: true });

const links = [];
for (const theme of [LIGHT, DARK]) {
  for (const d of DEVICES) {
    const W = d.w * d.r, H = d.h * d.r;
    // Logo ≈ 38% of the narrow side — matches the optical weight of a native
    // launch screen without looking stretched on tall devices.
    const logo = Math.round(Math.min(W, H) * 0.38);
    const icon = await sharp("public/icon-512.png").resize(logo, logo, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
    const file = `${OUT}/splash-${d.w}x${d.h}@${d.r}x-${theme.name}.png`;
    await sharp({ create: { width: W, height: H, channels: 4, background: theme.bg } })
      .composite([{ input: icon, gravity: "center" }])
      .png({ compressionLevel: 9 })
      .toFile(file);
    links.push(
      `<link rel="apple-touch-startup-image" media="(device-width: ${d.w}px) and (device-height: ${d.h}px) and (-webkit-device-pixel-ratio: ${d.r}) and (prefers-color-scheme: ${theme.name})" href="/splash/splash-${d.w}x${d.h}@${d.r}x-${theme.name}.png" />`
    );
  }
}

console.log(links.join("\n"));
console.log(`\n${links.length} splash images → ${OUT}`);
