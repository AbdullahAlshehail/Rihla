// Legacy /places list-only route — now redirects to the unified /map view.
// /map has both a map and a list view (toggle in header), uses identical
// filters, and shows the same catalogue scoped to the active city. Keeps old
// bookmarks working without two separate discover surfaces.

import { redirect } from "next/navigation";

export default async function PlacesRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ cat?: string; kind?: string; q?: string; gem?: string; trend?: string; slot?: string; day?: string }>;
}) {
  const { tripId } = await params;
  const sp = await searchParams;
  // Preserve trend-mode redirects (?trend=1 was the only param the new flow
  // tracks). Other legacy filters were category drill-downs that the new
  // map surface handles via its filter sheet — they'd be re-applied by tapping.
  const qs = sp.trend === "1" ? "?tab=discover&view=list" : "?tab=discover";
  redirect(`/trips/${tripId}/map${qs}`);
}
