"use client";

// Edit profile sheet — display name, unique @username (needed so friends can
// find you via find_user_by_username), and an avatar emoji. Writes directly
// through the browser Supabase client; RLS only allows updating your own row.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const AVATAR_EMOJIS = [
  "🧭", "✈️", "🌍", "🏔", "🏝", "🐪", "🦅", "🌵",
  "☕", "🍜", "📸", "🎒", "🚀", "⛺", "🌊", "🕌",
];

export default function EditProfileSheet({
  userId,
  initialName,
  initialUsername,
  initialEmoji,
  onClose,
}: {
  userId: string;
  initialName: string;
  initialUsername: string | null;
  initialEmoji: string | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [username, setUsername] = useState(initialUsername ?? "");
  const [emoji, setEmoji] = useState<string | null>(initialEmoji);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function save() {
    const trimmedName = name.trim();
    const handle = username.trim().toLowerCase();
    if (!trimmedName) {
      setError("اكتب اسمك الظاهر للأصدقاء");
      return;
    }
    if (handle && !/^[a-z0-9_]{3,20}$/.test(handle)) {
      setError("اسم المستخدم: ٣–٢٠ حرف إنجليزي صغير أو رقم أو _");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase
      .from("user_profiles")
      .update({
        display_name: trimmedName,
        username: handle || null,
        avatar_emoji: emoji,
      })
      .eq("id", userId);
    setSaving(false);
    if (err) {
      if (err.code === "23505") setError("اسم المستخدم محجوز — جرّب غيره");
      else setError("تعذّر الحفظ — حاول مرة ثانية");
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[1600] bg-black/50 animate-backdrop-fade flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="تعديل ملفي"
    >
      <div
        className="w-full max-w-lg bg-card rounded-t-3xl sm:rounded-3xl px-5 pt-3 shadow-[0_-12px_40px_rgba(0,0,0,0.3)] animate-sheet-up max-h-[90dvh] overflow-y-auto overscroll-contain"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)" }}
      >
        <div className="w-9 h-[5px] bg-ink/30 rounded-full mx-auto mb-4" />
        <h2 className="font-extrabold text-[18px] text-ink text-center">ملفي</h2>

        <label className="block text-[12.5px] font-extrabold text-ink mt-5 mb-1.5" htmlFor="ep-name">
          الاسم الظاهر
        </label>
        <input
          id="ep-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="اسمك للأصدقاء"
          className="w-full min-h-[46px] rounded-2xl border border-line bg-sand text-ink text-base px-3.5 outline-none focus:border-sea placeholder:text-muted"
        />

        <label className="block text-[12.5px] font-extrabold text-ink mt-4 mb-1.5" htmlFor="ep-username">
          اسم المستخدم <span className="text-muted font-medium text-[11px]">(يبحث به أصدقاؤك عنك)</span>
        </label>
        <div className="relative">
          <input
            id="ep-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={20}
            dir="ltr"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="sultan_q"
            className="w-full min-h-[46px] rounded-2xl border border-line bg-sand text-ink text-base px-3.5 pl-8 outline-none focus:border-sea placeholder:text-muted text-left"
          />
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted font-bold" aria-hidden="true">@</span>
        </div>

        <div className="text-[12.5px] font-extrabold text-ink mt-4 mb-2">صورتك الرمزية</div>
        <div className="grid grid-cols-8 gap-1.5" role="radiogroup" aria-label="اختر رمز صورتك">
          {AVATAR_EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => setEmoji((cur) => (cur === e ? null : e))}
              role="radio"
              aria-checked={emoji === e}
              aria-label={e}
              className={`aspect-square min-h-[40px] grid place-items-center text-[22px] rounded-xl border transition active:scale-90 ${
                emoji === e ? "bg-sea/15 border-sea" : "bg-sand border-line"
              }`}
            >
              {e}
            </button>
          ))}
        </div>

        {error && (
          <p className="mt-3 text-[12.5px] font-bold text-danger bg-danger/10 border border-danger/30 rounded-xl p-3 leading-relaxed" role="alert">
            ⚠ {error}
          </p>
        )}

        <button
          onClick={save}
          disabled={saving}
          className="w-full min-h-[50px] rounded-2xl bg-gradient-to-br from-sea to-sea-600 text-white font-extrabold text-[15px] mt-5 shadow-btn-sea active:scale-[0.98] transition disabled:opacity-60"
        >
          {saving ? "يحفظ..." : "حفظ"}
        </button>
      </div>
    </div>
  );
}
