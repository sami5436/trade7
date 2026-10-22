import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="text-7xl font-extrabold tracking-tight">404</div>
      <p className="text-white/55">This page does not exist.</p>
      <Link href="/" className="flex h-12 items-center rounded-2xl bg-white px-6 font-bold text-black">
        HOME
      </Link>
    </main>
  );
}
