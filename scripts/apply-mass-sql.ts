// Apply /tmp/mass.sql via the Supabase Postgres REST endpoint.
// Splits the file into batches of 100 INSERTs and POSTs each as one
// multi-statement query via the supabase-js `rpc` mechanism is not available
// for arbitrary SQL — we use the PostgREST `query` admin endpoint that ships
// with Supabase: `${SUPABASE_URL}/database/query` requires service role JWT.
// Falls back to the supabase-js REST insert path if /database/query is closed.
import { config } from "dotenv"; config({ path: ".env.local" });
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL || !KEY) { console.error("missing env"); process.exit(1); }

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

// Parse one `INSERT INTO places (cols) VALUES (vals) ON CONFLICT (...) DO NOTHING;`
// into an object we can pass to supabase.from('places').insert().
const COLS = [
  "name","city","city_label","category","kind","address","lat","lng",
  "rating","review_count","price_level","photo_url","google_place_id",
  "external_source","cost_currency","cost_confidence","data_freshness","is_editor_pick",
] as const;

function parseRow(line: string): Record<string, unknown> | null {
  const m = line.match(/VALUES \((.+)\) ON CONFLICT/s);
  if (!m) return null;
  // Naive tokenizer that respects quoted strings with '' escape.
  const tokens: string[] = [];
  let buf = "";
  let inStr = false;
  let prev = "";
  for (let i = 0; i < m[1].length; i++) {
    const ch = m[1][i];
    if (inStr) {
      if (ch === "'" && m[1][i + 1] === "'") { buf += "'"; i++; continue; }
      if (ch === "'") { inStr = false; tokens.push(buf); buf = ""; continue; }
      buf += ch;
    } else {
      if (ch === "'") {
        // Drop inter-token whitespace before the opening quote — otherwise it
        // leaks into the next captured string value (" EUR" instead of "EUR").
        if (buf.trim() === "") buf = "";
        inStr = true;
        continue;
      }
      if (ch === ",") {
        if (buf.trim()) { tokens.push(buf.trim()); buf = ""; }
        continue;
      }
      buf += ch;
    }
    prev = ch;
  }
  if (buf.trim()) tokens.push(buf.trim());
  if (tokens.length !== COLS.length) return null;
  const row: Record<string, unknown> = {};
  for (let i = 0; i < COLS.length; i++) {
    const col = COLS[i];
    const raw = tokens[i];
    if (raw === "NULL") row[col] = null;
    else if (raw === "NOW()") row[col] = new Date().toISOString();
    else if (raw === "true") row[col] = true;
    else if (raw === "false") row[col] = false;
    else if (col === "lat" || col === "lng" || col === "rating") row[col] = parseFloat(raw);
    else if (col === "review_count" || col === "price_level") row[col] = parseInt(raw, 10);
    else row[col] = raw;
  }
  return row;
}

(async () => {
  const path = process.platform === "win32"
    ? `${process.env.TEMP}\\mass.sql`
    : "/tmp/mass.sql";
  const text = fs.readFileSync(path, "utf8");
  const lines = text.split("\n").filter((l) => l.startsWith("INSERT"));
  console.log(`parsed ${lines.length} INSERT lines`);
  const rows = lines.map(parseRow).filter(Boolean) as Record<string, unknown>[];
  console.log(`got ${rows.length} valid rows`);

  const CHUNK = 200;
  let ok = 0, dupes = 0, errors = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("places")
      .upsert(chunk as any, { onConflict: "google_place_id", ignoreDuplicates: true })
      .select("id");
    if (error) {
      errors++;
      console.error(`batch ${i}-${i + chunk.length}: ${error.message}`);
    } else {
      ok += data?.length ?? 0;
      dupes += chunk.length - (data?.length ?? 0);
      process.stdout.write(`.`);
    }
  }
  console.log(`\n✓ inserted ${ok} / dupes ${dupes} / errors ${errors}`);
})();
