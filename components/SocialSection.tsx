"use client";

// Glue between the friend feed and the friends manager: accepting a request
// bumps `refreshKey`, so the feed refetches and the new friend's check-ins
// appear immediately without a page reload.

import { useState } from "react";
import FriendFeed from "@/components/FriendFeed";
import FriendsSection from "@/components/FriendsSection";

export default function SocialSection({ hasUsername }: { hasUsername: boolean }) {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <>
      <FriendFeed refreshKey={refreshKey} />
      <FriendsSection
        hasUsername={hasUsername}
        onFriendsChanged={() => setRefreshKey((k) => k + 1)}
      />
    </>
  );
}
