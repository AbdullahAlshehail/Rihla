import Link from "next/link";

export default function BottomNav({ active }: { active: "trips" | "profile" }) {
  const cls = (k: typeof active) =>
    `flex-1 flex flex-col items-center gap-1 py-2 min-h-[52px] font-bold text-[10.5px] ${
      active === k ? "text-sea" : "text-muted"
    }`;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-50 bg-white/95 backdrop-blur border-t border-line flex"
      style={{ paddingBottom: "calc(6px + env(safe-area-inset-bottom))", paddingTop: 6 }}
    >
      <Link href="/trips" className={cls("trips")}>
        <span className="text-[22px]">🗂</span>
        رحلاتي
      </Link>
      <Link href="/trips/new" className="flex-1 flex flex-col items-center gap-1 py-2 min-h-[52px] text-coral font-bold text-[10.5px]">
        <span className="text-white bg-coral rounded-xl w-10 h-10 grid place-items-center text-[22px] shadow">＋</span>
        جديدة
      </Link>
      <Link href="/profile" className={cls("profile")}>
        <span className="text-[22px]">👤</span>
        حسابي
      </Link>
    </nav>
  );
}
