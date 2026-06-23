// Trip page — now redirects straight to the unified map view (Discover +
// Plan tabs). The old hub page is gone per user request: "احذف الصفحة اللي
// قبل اللي فيها خطتي واكتشف… ابي على طول يفتح الخريطة".
//
// Deep links (/now, /day, /plan, /places) still work via their own files;
// /plan and /places already redirect here too.

import { redirect } from "next/navigation";

export default async function TripRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ tab?: string; view?: string; expand?: string; add?: string }>;
}) {
  const { tripId } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (sp.tab) qs.set("tab", sp.tab);
  if (sp.view) qs.set("view", sp.view);
  if (sp.expand) qs.set("expand", sp.expand);
  if (sp.add) qs.set("add", sp.add);   // ?add=<placeId> deep-link still passes through
  const query = qs.toString();
  redirect(`/trips/${tripId}/map${query ? `?${query}` : ""}`);
}
