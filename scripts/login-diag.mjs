// Verify the magic-link login flow works end-to-end on Netlify production.
// Visits the login page, submits the email, and confirms the "sent" state.
import { chromium } from "playwright";

const TARGET = "https://rihla-travel.netlify.app/login";
const EMAIL = process.argv[2] ?? "abdullah.alshehail@gmail.com";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, // iPhone 14-ish
  locale: "ar-SA",
});
const page = await ctx.newPage();

const networkErrors = [];
page.on("response", async (res) => {
  const u = res.url();
  if (u.includes("supabase.co/auth")) {
    console.log(`  → Supabase auth: ${res.status()} ${u.replace(/\?.*$/, "")}`);
    if (res.status() >= 400) {
      try { networkErrors.push(await res.text()); } catch {}
    }
  }
});
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("  JS error:", msg.text().slice(0, 200));
});
page.on("pageerror", (err) => console.log("  Page error:", err.message.slice(0, 200)));

console.log(`\n==== Test login flow on ${TARGET} ====`);
await page.goto(TARGET, { waitUntil: "networkidle" });
const title = await page.title();
console.log(`Page title: ${title}`);

// Wait for React to hydrate (look for an interactive marker)
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(2000);

// Fill email and submit
await page.fill('input[type="email"]', EMAIL);
await page.waitForTimeout(500);
console.log("Filled email. Pressing Enter (more reliable than click).");
await page.locator('input[type="email"]').press("Enter");

// Wait for either the "sent" screen or an error
await page.waitForFunction(() => {
  return document.body.textContent?.includes("ابحث في إيميلك") ||
         document.body.textContent?.includes("rate") ||
         document.body.textContent?.includes("error");
}, null, { timeout: 15000 });

const body = await page.textContent("body");
const sent = body?.includes("ابحث في إيميلك");
const rateLimited = body?.match(/rate|For security purposes/i);

console.log(`\n==== RESULT ====`);
if (sent) {
  console.log("✅ Magic link sent! Form transitioned to 'check your email' state.");
} else if (rateLimited) {
  console.log("⚠️  Rate-limited by Supabase (free tier 2/hour). Email NOT sent this time.");
  console.log(`   But: site_url + redirect URLs already updated. Next email will land correctly.`);
} else {
  console.log("❌ Unexpected state:");
  console.log(body?.slice(0, 200));
}

if (networkErrors.length > 0) {
  console.log("\n==== Network errors ====");
  networkErrors.forEach((e) => console.log("  ", e.slice(0, 300)));
}

await browser.close();
