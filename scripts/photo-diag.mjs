// Diagnose photo rendering from a REAL browser perspective using Playwright.
// Steps:
//  1) Hit the proxy URL directly and report what the browser actually receives
//  2) Render a tiny HTML page with <img src=PROXY_URL> and watch for load/error
//  3) Capture every console error / failed network request
//  4) Print final answer: works ✓ / broken ✗ with diagnostics
import { chromium } from "playwright";

const REF = process.argv[2] ?? "AaVGc3m5bFCG-id_3thIMAZEiOSxm71a7aa68BlIQTOO1fZVLuIHVa8Qw_B77yzINrvIAGM2tRb6SnPaCaUipYcdm85vvodALvdHGqQseMFBZxyVpU-jujtaSoiHI_Jz4_R-UPeRGgexsxhJuJ-Ks46txFdZGs6NDtmm3Kqb3YcOpywUnT8dkBWay4tDcxQkbIOYC8s9WGRFO3aAhxAt5AR91kiGvor_5QYDcHV_7m-6NbxXPU5yxoUe4enNeWN-_fuMu6PK8JBnXbBoLI4-L-AS3U6mu4iQzOHTxMC_nCgvPFYkHJP-OKr9YmGIr5IVnCCjIASr8zNN2M7D07A5-WP_9hWZQvOhSJl9PAKNvRfgNIVOPhGqNaNUBDylEbX8-Z6edGi7m46A18fcwOIwoGLwHATin5YTherRUm6Ve0Ya6peo8Mc";
const PROXY_URL = `http://localhost:3000/api/photo?ref=${REF}&w=800`;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const consoleErrors = [];
const failedRequests = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("requestfailed", (req) => {
  failedRequests.push({ url: req.url(), failure: req.failure()?.errorText });
});

// 1) Direct hit on the proxy URL
console.log("==== TEST 1: Direct browser fetch of proxy ====");
const resp = await page.goto(PROXY_URL, { waitUntil: "load" });
console.log("Status:", resp.status());
console.log("Content-Type:", resp.headers()["content-type"]);
console.log("Cache-Control:", resp.headers()["cache-control"]);
console.log("Content-Length:", resp.headers()["content-length"]);
const buf = await resp.body();
console.log("Body size:", buf.length, "bytes");
console.log("First 8 bytes (hex):", buf.subarray(0, 8).toString("hex"), "(JPEG=ffd8ff)");

// 2) Render <img> tag to verify browser can DISPLAY it
console.log("\n==== TEST 2: <img> rendering ====");
await page.setContent(`
<!DOCTYPE html>
<html><body style="margin:0;padding:0">
<img id="x" src="${PROXY_URL}" style="display:block;width:400px;background:#eee" />
<script>
window.imgResult = new Promise((resolve) => {
  const img = document.getElementById('x');
  img.onload = () => resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
  img.onerror = (e) => resolve({ ok: false, error: 'onerror fired' });
  setTimeout(() => resolve({ ok: false, error: 'timeout 8s' }), 8000);
});
</script>
</body></html>`, { waitUntil: "domcontentloaded" });

const imgResult = await page.evaluate(() => window.imgResult);
console.log("Result:", imgResult);

// 3) Take a screenshot to see what the browser actually shows
await page.screenshot({ path: "C:/Users/User/OneDrive/Documents/Travel/rihla-app/scripts/photo-diag.png" });
console.log("Screenshot saved: scripts/photo-diag.png");

console.log("\n==== Console errors ====");
console.log(consoleErrors.length === 0 ? "(none)" : consoleErrors.join("\n"));
console.log("\n==== Failed requests ====");
console.log(failedRequests.length === 0 ? "(none)" : failedRequests.map(f => `${f.url} → ${f.failure}`).join("\n"));

// Final verdict
console.log("\n==== VERDICT ====");
if (resp.status() === 200 && imgResult.ok && imgResult.w > 0) {
  console.log("✅ Photo loads and renders correctly in a real browser.");
  console.log(`   Image size: ${imgResult.w}×${imgResult.h}`);
  console.log("   → If user sees broken image, it MUST be browser cache.");
} else {
  console.log("❌ Photo failed:", { status: resp.status(), imgResult });
}

await browser.close();
