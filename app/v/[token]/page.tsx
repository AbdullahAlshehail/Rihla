// Public participant voting board, reached only via an unguessable share link.
// noindex + no-referrer so the link never leaks into search or referrers.
import type { Metadata } from "next";
import VoteBoard from "@/components/VoteBoard";

export const metadata: Metadata = {
  title: "صوّتوا للرحلة 🔥",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <VoteBoard token={token} />;
}
