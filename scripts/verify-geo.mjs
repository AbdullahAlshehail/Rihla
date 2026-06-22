// End-to-end verification of the geolocation feature on production.
// Logs in with password, mocks Riyadh coordinates, opens Discover, and
// confirms the card distance chips + proximity-first sort.
import { chromium } from "playwright";

const BASE  = "https://rihla-travel.netlify.app";
const EMAIL = "abdullah.alshehail@gmail.com";
const PW    = "1234@@";
// Riyadh — North Hittin (a real spot in the catalogue)
const RIYADH = { latitude: 24.7691, longitude: 46.6038 };

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, // iPhone size
  locale: "ar-SA",
  // Mock geolocation BEFORE any page loads
  geolocation: RIYADH,
  permissions: ["geolocation"],
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  ⚠️ Page error:", e.message.slice(0, 150)));

console.log("==== STEP 1: Login ====");
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PW);
await page.click('button[type="submit"]');
await page.waitForURL(/\/trips/, { timeout: 15000 });
console.log("  ✅ Logged in. URL:", page.url());

console.log("\n==== STEP 2: Open the Riyadh trip ====");
// Go directly to the Riyadh trip (matches our mocked Riyadh location)
const RIYADH_TRIP_ID = "1c5276c0-483e-4e4f-a49f-ff933e1d7dae";
await page.goto(`${BASE}/trips/${RIYADH_TRIP_ID}`, { waitUntil: "networkidle" });
console.log("  Opened. URL:", page.url());
await page.waitForTimeout(2500);

console.log("\n==== STEP 3: Go to Discover tab ====");
// The Discover tab is in TripScreen — usually a button in a sticky tab row
const discoverBtn = page.locator('button, a').filter({ hasText: /اكتشف/ }).first();
const found = await discoverBtn.count();
if (found > 0) {
  await discoverBtn.click({ timeout: 5000 });
  await page.waitForTimeout(2500);
} else {
  console.log("  (No اكتشف tab found — assuming we're already in Discover mode)");
}

console.log("\n==== STEP 4: Share location ====");
// Click "شارك موقعك" CTA. Geolocation already granted via context.
const shareBtn = page.locator('button').filter({ hasText: /شارك موقعك|الأقرب/ }).first();
const shareBtnExists = await shareBtn.count() > 0;
if (shareBtnExists) {
  console.log("  Clicking 'share location' button...");
  await shareBtn.click();
  await page.waitForTimeout(2500);
} else {
  console.log("  (No share button — geo already cached in session)");
}

console.log("\n==== STEP 5: Check distance chips on cards ====");
await page.waitForTimeout(1500);
const bodyText = await page.textContent("body");
const hasMine = bodyText?.includes("منك");
const hasWalk = bodyText?.includes("🚶");
const hasDrive = bodyText?.includes("🚗");
const hasKm = /\d+(\.\d+)?\s*كم/.test(bodyText ?? "");

console.log(`  '📍 منك' label present: ${hasMine ? "✅" : "❌"}`);
console.log(`  🚶 walk chip present:   ${hasWalk ? "✅" : "❌"}`);
console.log(`  🚗 drive chip present:  ${hasDrive ? "✅" : "❌"}`);
console.log(`  km distance present:    ${hasKm ? "✅" : "❌"}`);

console.log("\n==== STEP 6: Verify proximity-first sort ====");
// Read the first 5 card distances and assert they're sorted ascending
const distances = await page.locator('article').evaluateAll((articles) => {
  return articles.slice(0, 5).map((el) => {
    const m = el.textContent?.match(/(\d+(?:\.\d+)?)\s*كم/);
    return m ? parseFloat(m[1]) : null;
  });
});
console.log("  First 5 card km:", distances);
const valid = distances.filter((d) => d != null);
const sorted = valid.every((d, i) => i === 0 || d >= (valid[i-1] ?? 0));
console.log(`  Sorted ascending by km: ${sorted ? "✅" : "❌"}`);

await page.screenshot({ path: "scripts/verify-geo-screenshot.png", fullPage: false });
console.log("\nScreenshot: scripts/verify-geo-screenshot.png");

console.log("\n==== VERDICT ====");
if (hasMine && hasWalk && hasDrive && hasKm && sorted) {
  console.log("✅ Geolocation feature working end-to-end on production.");
} else {
  console.log("⚠️  Some checks failed — see above.");
}

await browser.close();
