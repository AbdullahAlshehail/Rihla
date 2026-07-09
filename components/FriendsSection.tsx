"use client";

// الأصدقاء — search by @username, incoming requests (قبول/رفض), friends list.
// Wired straight to the SECURITY DEFINER RPCs (my_friends /
// pending_friend_requests / find_user_by_username / send_friend_request /
// respond_friend_request) through the browser Supabase client — the session
// travels with every call, and the functions are authenticated-only.

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { avatarColor, friendlyName } from "@/lib/social/format";

type PersonRow = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_emoji: string | null;
};
type SearchRow = PersonRow & { friend_status: string };
type PendingRow = Omit<PersonRow, "id"> & { from_id: string };

export default function FriendsSection({
  hasUsername,
  onFriendsChanged,
}: {
  hasUsername: boolean;
  /** Fired after accepting a request — lets the feed refetch. */
  onFriendsChanged: () => void;
}) {
  const [friends, setFriends] = useState<PersonRow[] | null>(null);
  const [pending, setPending] = useState<PendingRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [f, p] = await Promise.all([
      supabase.rpc("my_friends"),
      supabase.rpc("pending_friend_requests"),
    ]);
    setFriends((f.data as PersonRow[]) ?? []);
    setPending((p.data as PendingRow[]) ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Debounced username / name search.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 2) { setResults(null); setSearching(false); return; }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("find_user_by_username", { handle: q });
      setSearching(false);
      if (error) { setResults([]); return; }
      setResults(((data as SearchRow[]) ?? []).filter((r) => r.friend_status !== "blocked"));
    }, 300);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query]);

  async function sendRequest(to: SearchRow) {
    setBusy(to.id);
    setNotice(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("send_friend_request", { to_user: to.id });
    setBusy(null);
    if (error) { setNotice("تعذّر إرسال الطلب — حاول مرة ثانية"); return; }
    setResults((rs) => rs?.map((r) => (r.id === to.id ? { ...r, friend_status: "pending" } : r)) ?? null);
    setNotice(`أُرسل طلب صداقة إلى ${friendlyName(to.display_name, to.username)} ✓`);
  }

  async function respond(req: PendingRow, accept: boolean) {
    setBusy(req.from_id);
    setNotice(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("respond_friend_request", {
      from_user: req.from_id,
      accept,
    });
    setBusy(null);
    if (error) { setNotice("تعذّر تحديث الطلب — حاول مرة ثانية"); return; }
    setPending((ps) => ps?.filter((p) => p.from_id !== req.from_id) ?? null);
    if (accept) {
      setFriends((fs) => [
        ...(fs ?? []),
        { id: req.from_id, display_name: req.display_name, username: req.username, avatar_emoji: req.avatar_emoji },
      ]);
      onFriendsChanged();
    }
  }

  return (
    <section id="friends" className="mt-6 scroll-mt-4" aria-label="الأصدقاء">
      <h2 className="font-extrabold text-[16px] text-ink mb-2 px-1">الأصدقاء</h2>

      {!hasUsername && (
        <button
          onClick={() => window.dispatchEvent(new Event("rihla:edit-profile"))}
          className="w-full text-right bg-gold/10 border border-gold/40 rounded-2xl p-3.5 mb-2.5 active:scale-[0.99] transition"
        >
          <span className="text-[12.5px] font-bold text-ink leading-relaxed">
            💡 حدّد اسم مستخدم من ملفك ليقدر أصدقاؤك يلقونك ويرسلون لك طلبات —{" "}
            <span className="text-sea font-extrabold">اضغط هنا</span>
          </span>
        </button>
      )}

      {/* Search */}
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="أضف صديق — ابحث باسم المستخدم"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full min-h-[48px] rounded-2xl border border-line bg-card text-ink text-base pr-11 pl-3.5 outline-none focus:border-sea placeholder:text-muted shadow-sm"
          aria-label="ابحث عن صديق باسم المستخدم"
        />
        <Search size={18} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
      </div>

      {notice && (
        <p className="mt-2 text-[12px] font-bold text-sea bg-sea/10 rounded-xl px-3 py-2" role="status">
          {notice}
        </p>
      )}

      {/* Search results */}
      {query.trim().length >= 2 && (
        <div className="mt-2.5 flex flex-col gap-2">
          {searching && <div className="h-[56px] rounded-2xl skeleton-shimmer" aria-hidden="true" />}
          {!searching && results?.length === 0 && (
            <div className="rounded-2xl border border-line bg-card p-3.5 text-center text-[12.5px] text-muted font-bold">
              ما لقينا أحد بهالاسم — تأكد من اسم المستخدم
            </div>
          )}
          {!searching &&
            results?.map((r) => (
              <PersonCard key={r.id} id={r.id} name={friendlyName(r.display_name, r.username)} username={r.username} emoji={r.avatar_emoji}>
                {r.friend_status === "accepted" ? (
                  <span className="text-[12px] font-extrabold text-ok">صديق ✓</span>
                ) : r.friend_status === "pending" ? (
                  <span className="text-[12px] font-extrabold text-muted">بانتظار القبول</span>
                ) : (
                  <button
                    onClick={() => sendRequest(r)}
                    disabled={busy === r.id}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-pill bg-gradient-to-br from-sea to-sea-600 text-white text-[12.5px] font-extrabold shadow-btn-sea active:scale-95 transition disabled:opacity-60"
                  >
                    <UserPlus size={14} aria-hidden="true" />
                    إضافة
                  </button>
                )}
              </PersonCard>
            ))}
        </div>
      )}

      {/* Incoming requests */}
      {pending && pending.length > 0 && (
        <>
          <h3 className="text-[12px] font-extrabold text-muted mt-4 mb-2 px-1">
            طلبات صداقة واردة
          </h3>
          <div className="flex flex-col gap-2">
            {pending.map((p) => (
              <PersonCard key={p.from_id} id={p.from_id} name={friendlyName(p.display_name, p.username)} username={p.username} emoji={p.avatar_emoji} highlight>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => respond(p, true)}
                    disabled={busy === p.from_id}
                    className="min-h-[40px] px-3.5 rounded-pill bg-gradient-to-br from-coral to-coral-600 text-white text-[12.5px] font-extrabold shadow-btn active:scale-95 transition disabled:opacity-60"
                  >
                    قبول
                  </button>
                  <button
                    onClick={() => respond(p, false)}
                    disabled={busy === p.from_id}
                    className="min-h-[40px] px-3 rounded-pill border border-line bg-card text-muted text-[12.5px] font-bold active:scale-95 transition disabled:opacity-60"
                  >
                    رفض
                  </button>
                </div>
              </PersonCard>
            ))}
          </div>
        </>
      )}

      {/* Friends list */}
      <div className="mt-4 flex flex-col gap-2">
        {friends === null && <div className="h-[56px] rounded-2xl skeleton-shimmer" aria-hidden="true" />}
        {friends?.length === 0 && (pending?.length ?? 0) === 0 && (
          <div className="rounded-2xl border border-dashed border-line bg-card p-4 text-center text-[12.5px] text-muted font-bold leading-relaxed">
            ما عندك أصدقاء بعد — ابحث فوق باسم المستخدم وأرسل أول طلب
          </div>
        )}
        {friends?.map((f) => (
          <PersonCard key={f.id} id={f.id} name={friendlyName(f.display_name, f.username)} username={f.username} emoji={f.avatar_emoji} />
        ))}
      </div>
    </section>
  );
}

function PersonCard({
  id,
  name,
  username,
  emoji,
  highlight,
  children,
}: {
  id: string;
  name: string;
  username: string | null;
  emoji: string | null;
  highlight?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl px-3.5 py-2.5 border ${
        highlight ? "bg-coral/5 border-coral/30" : "bg-card border-line"
      }`}
    >
      <span
        className="w-10 h-10 rounded-full grid place-items-center text-[17px] text-white font-extrabold shrink-0"
        style={{ backgroundColor: avatarColor(id) }}
        aria-hidden="true"
      >
        {emoji ?? name.charAt(0)}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-[13.5px] text-ink truncate">{name}</div>
        {username && (
          <div className="text-[11px] text-muted truncate" dir="ltr">@{username}</div>
        )}
      </div>
      {children}
    </div>
  );
}
