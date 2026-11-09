"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Two-step folder delete: first click arms the confirm state (no modal,
 * no accidental one-tap loss), second click calls DELETE /api/links/[id]
 * and either refreshes the list (home) or returns home (folder page).
 *
 * variant "paper" sits on the cream film-frame cards; "dark" sits on the
 * darkroom background of the folder page.
 */
export default function DeleteFolderButton({
  linkId,
  variant = "paper",
  redirectHome = false,
}: {
  linkId: string;
  variant?: "paper" | "dark";
  redirectHome?: boolean;
}) {
  const router = useRouter();
  const [arming, setArming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleDelete() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/links/${linkId}`, { method: "DELETE" });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      if (redirectHome) {
        router.push("/");
      }
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      setArming(false);
    }
  }

  const idleCls =
    variant === "paper"
      ? "text-sm text-rust/70 hover:text-rust"
      : "font-mono text-xs uppercase tracking-widest text-rust/80 hover:text-rust";
  const confirmCls =
    variant === "paper"
      ? "text-sm font-medium text-white bg-rust rounded-full px-3 py-1 disabled:opacity-50"
      : "font-mono text-xs uppercase tracking-widest text-white bg-rust rounded-full px-3 py-1.5 disabled:opacity-50";
  const cancelCls =
    variant === "paper"
      ? "text-sm text-ink/60 hover:text-ink"
      : "font-mono text-xs uppercase tracking-widest text-paper/60 hover:text-paper";

  if (!arming) {
    return (
      <button type="button" onClick={() => setArming(true)} className={idleCls}>
        Delete
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={handleDelete} disabled={busy} className={confirmCls}>
        {busy ? "Deleting…" : failed ? "Retry delete" : "Confirm delete"}
      </button>
      <button type="button" onClick={() => setArming(false)} disabled={busy} className={cancelCls}>
        Cancel
      </button>
    </span>
  );
}
