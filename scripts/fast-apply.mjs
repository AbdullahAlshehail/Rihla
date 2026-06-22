// Fast bulk-apply: parse /tmp/inserts.sql and POST to Supabase REST API.
import fs from "node:fs";

const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprZHNoeW5peGh4d3VzcGNjY3pxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDQwNzUxOSwiZXhwIjoyMDk1OTgzNTE5fQ.b4HzJeKimuO5xI3vqbSA5E6NV6N8Wk5mkPFmXrh92R8";
const URL = "https://zkdshynixhxwuspccczq.supabase.co";

const COLS = [
  "name","city","city_label","category","kind","address","lat","lng",
  "rating","review_count","price_level","photo_url","google_place_id",
  "external_source","cost_currency","cost_confidence","data_freshness","is_editor_pick",
];

function parseRow(line) {
  const m = line.match(/VALUES \((.+)\) ON CONFLICT/s);
  if (!m) return null;
  const tokens = [];
  let buf = "", inStr = false;
  for (let i = 0; i < m[1].length; i++) {
    const ch = m[1][i];
    if (inStr) {
      if (ch === "'" && m[1][i + 1] === "'") { buf += "'"; i++; continue; }
      if (ch === "'") { inStr = false; tokens.push(buf); buf = ""; continue; }
      buf += ch;
    } else {
      if (ch === "'") {
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
  }
  if (buf.trim()) tokens.push(buf.trim());
  if (tokens.length !== COLS.length) return null;
  const row = {};
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

const sqlPath = process.platform === "win32"
  ? `${process.env.TEMP}\\inserts.sql`
  : "/tmp/inserts.sql";
const sql = fs.readFileSync(sqlPath, "utf8");
const lines = sql.split("\n").filter((l) => l.startsWith("INSERT"));
const rows = lines.map(parseRow).filter(Boolean);
console.log(`Parsed ${rows.length} rows`);

let ok = 0, dupes = 0, errors = 0;
const CHUNK = 50;
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  const r = await fetch(`${URL}/rest/v1/places?on_conflict=google_place_id`, {
    method: "POST",
    headers: {
      "apikey": JWT,
      "Authorization": `Bearer ${JWT}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(chunk),
  });
  if (!r.ok) {
    errors++;
    console.error(`batch ${i}: HTTP ${r.status} — ${await r.text()}`);
  } else {
    ok += chunk.length;
    process.stdout.write(`.`);
  }
}
console.log(`\n✓ posted ${ok} rows · ${errors} batch errors`);
