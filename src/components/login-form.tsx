"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/hooks/use-api";

export function LoginForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { json: { passcode: code } });
      window.location.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm">
      <div className="text-6xl font-extrabold tracking-tight">TRADE7</div>
      <p className="mt-2 text-white/50">Momentum trading terminal</p>
      <label htmlFor="passcode" className="mt-10 block text-xs font-semibold tracking-[0.18em] text-white/50 uppercase">
        Passcode
      </label>
      <input
        id="passcode"
        type="password"
        inputMode="text"
        autoComplete="current-password"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="mt-2 h-14 w-full rounded-2xl border border-white/15 bg-[#0a0a0a] px-4 text-lg tracking-widest outline-none focus:border-white/60"
        autoFocus
      />
      {error && <p className="mt-3 text-sm font-medium">{error}</p>}
      <button
        type="submit"
        disabled={busy || code.length === 0}
        className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white text-base font-bold tracking-wide text-black disabled:opacity-40"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        UNLOCK
      </button>
    </form>
  );
}
