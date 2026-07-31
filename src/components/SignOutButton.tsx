"use client";

import { useRouter } from "next/navigation";

export default function SignOutButton() {
  const router = useRouter();

  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/signout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
      className="font-mono text-xs uppercase tracking-widest text-paper/60 hover:text-paper"
    >
      Sign out
    </button>
  );
}
