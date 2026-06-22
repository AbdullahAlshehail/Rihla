// Generate PWA + Apple touch icons by rendering a tiny HTML page in Chromium
// and screenshotting it. Cheaper than installing sharp/canvas.
import { chromium } from "playwright";
import path from "node:path";

const sizes = [
  { name: "icon-192.png",         size: 192 },
  { name: "icon-512.png",         size: 512 },
  { name: "apple-touch-icon.png", size: 180 }, // iOS standard
];

const HTML = (px) => `
<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; }
  .ico {
    width: ${px}px; height: ${px}px;
    background: linear-gradient(135deg, #0c4a63 0%, #133a5c 50%, #0f3a5e 100%);
    display: grid; place-items: center;
    border-radius: ${Math.round(px * 0.18)}px;
    box-shadow: inset 0 -8px 24px rgba(0,0,0,.2);
    font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui;
    font-size: ${Math.round(px * 0.58)}px;
    color: white;
    line-height: 1;
  }
</style></head>
<body><div class="ico">🎒</div></body></html>`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });

for (const { name, size } of sizes) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(HTML(size), { waitUntil: "load" });
  const out = path.resolve("public", name);
  await page.locator(".ico").screenshot({ path: out, omitBackground: false });
  console.log(`✓ ${name} (${size}x${size})`);
  await page.close();
}
await browser.close();
