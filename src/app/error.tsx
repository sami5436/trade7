"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="text-3xl font-extrabold tracking-tight">Something broke</div>
      <p className="max-w-sm text-white/55">No trades were placed by this error. Try again.</p>
      <button type="button" onClick={reset} className="h-12 rounded-2xl bg-white px-6 font-bold text-black">
        RETRY
      </button>
    </main>
  );
}
