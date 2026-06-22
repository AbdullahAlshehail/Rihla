// Legacy /plan route — now redirects to the unified /map?tab=plan view.
// Kept as a server redirect so old links/bookmarks still work.

import { redirect } from "next/navigation";

export default async function PlanRedirect({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  redirect(`/trips/${tripId}/map?tab=plan`);
}
