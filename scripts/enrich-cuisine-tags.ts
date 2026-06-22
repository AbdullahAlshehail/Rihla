// Add cuisine + offering Arabic tags to mass_discovery_v1 places based on
// their `kind`. These tags drive the Discover chips and let users instantly
// see "إيطالي" / "ياباني" / "قهوة مختصة" / "بيستري" etc. on each card.
// Runs locally; no Google calls.
import { config } from "dotenv"; config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL || !KEY || KEY.includes("PASTE")) { console.error("missing service role"); process.exit(1); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// kind → Arabic cuisine tag (food)
const FOOD_AR: Record<string, string[]> = {
  italian: ["إيطالي"], pizzeria: ["إيطالي", "بيتزا"], pizza: ["بيتزا"],
  japanese: ["ياباني"], sushi: ["سوشي"], korean: ["كوري"], chinese: ["صيني"],
  thai: ["تايلندي"], indian: ["هندي"],
  french: ["فرنسي"], brasserie: ["فرنسي", "براسيري"], nicois: ["نيسي"], bistro: ["بيسترو"],
  spanish: ["إسباني"], tapas: ["تاباس"], mexican: ["مكسيكي"], peruvian: ["بيروفي"],
  greek: ["يوناني"], turkish: ["تركي"],
  lebanese: ["لبناني", "شرقي"], yemeni: ["يمني"], saudi: ["سعودي"], najdi: ["نجدي"],
  british: ["بريطاني"], gastropub: ["بريطاني", "حانة طعام"], pub: ["حانة"],
  steakhouse: ["ستيك"], steak: ["ستيك"],
  seafood: ["مأكولات بحرية"], mediterranean: ["متوسطي"], traditional: ["تقليدي"],
  vegan: ["نباتي"], burger: ["برغر"], brunch: ["برانش"],
  fine_dining: ["فاين داينينق"], michelin: ["ميشلان"], michelin_3: ["ميشلان", "٣ نجوم"],
};

// kind → Arabic tag (coffee/sweet/sight/nature/bar/event)
const COFFEE_AR: Record<string, string[]> = {
  specialty: ["قهوة مختصة"], cafe: [],
};
const SWEET_AR: Record<string, string[]> = {
  patisserie: ["بيستري", "حلويات"], bakery: ["بيستري", "مخبز"],
  icecream: ["آيس كريم"], chocolate: ["شوكولاتة"], dessert: ["حلى"],
};
const SIGHT_AR: Record<string, string[]> = {
  museum: ["متحف", "ثقافي"], gallery: ["معرض فني", "ثقافي"],
  church: ["كنيسة", "ديني"], cathedral: ["كاتدرائية", "ديني"], abbey: ["دير", "ديني"], mosque: ["جامع", "ديني"],
  monument: ["نصب تذكاري"], historical: ["تاريخي"], landmark: ["معلم أيقوني", "أيقوني"],
  viewpoint: ["إطلالة"], palace: ["قصر"], tower: ["برج"], fort: ["حصن"],
};
const NATURE_AR: Record<string, string[]> = {
  park: ["حديقة"], beach: ["شاطئ"], garden: ["حديقة"],
  promenade: ["كورنيش"], wadi: ["وادي", "طبيعة"], desert: ["صحراء"],
};
const BAR_AR: Record<string, string[]> = {
  wine_bar: ["نبيذ"], cocktail: ["كوكتيلات"], speakeasy: ["سبيك إيزي"],
  rooftop: ["روف توب", "إطلالة"], shisha: ["شيشة"],
};
const EVENT_AR: Record<string, string[]> = {
  theatre: ["مسرح"], tour: ["جولة سياحية"], show: ["عرض"], activity: ["نشاط"],
};

function tagsFor(category: string, kind: string): string[] {
  const map = category === "food" ? FOOD_AR
            : category === "coffee" ? COFFEE_AR
            : category === "sweet" ? SWEET_AR
            : category === "sight" ? SIGHT_AR
            : category === "nature" ? NATURE_AR
            : category === "bar" ? BAR_AR
            : category === "event" ? EVENT_AR
            : {};
  return map[kind] ?? [];
}

(async () => {
  const { data, error } = await sb
    .from("places")
    .select("id, category, kind, tags")
    .eq("external_source", "mass_discovery_v1");
  if (error) { console.error(error); process.exit(1); }
  console.log(`found ${data.length} places to enrich`);

  const updates: { id: string; tags: string[] }[] = [];
  for (const p of data) {
    const newTags = tagsFor(p.category, p.kind ?? "");
    if (newTags.length === 0) continue;
    const merged = Array.from(new Set([...(p.tags ?? []), ...newTags]));
    if (merged.length !== (p.tags ?? []).length) {
      updates.push({ id: p.id, tags: merged });
    }
  }
  console.log(`updating ${updates.length} rows`);

  const CHUNK = 200;
  let ok = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK);
    await Promise.all(slice.map(async (u) => {
      const { error } = await sb.from("places").update({ tags: u.tags }).eq("id", u.id);
      if (!error) ok++;
    }));
    process.stdout.write(".");
  }
  console.log(`\n✓ updated ${ok}`);
})();
