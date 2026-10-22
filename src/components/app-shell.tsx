"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CandlestickChart, House, NotebookText, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusLine } from "./status-line";

const NAV = [
  { href: "/", label: "Home", icon: House },
  { href: "/markets", label: "Markets", icon: CandlestickChart },
  { href: "/journal", label: "Journal", icon: NotebookText },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="pt-safe sticky top-0 z-30 border-b border-white/10 bg-black/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 md:px-8">
          <Link href="/" className="text-lg font-extrabold tracking-tight" aria-label="TRADE7 home">
            TRADE7
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                  active(href) ? "bg-white text-black" : "text-white/60 hover:text-white",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
          <StatusLine />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-32 md:px-8 md:pb-16">{children}</main>
      <nav
        className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-black/90 backdrop-blur-xl md:hidden"
        aria-label="Main"
      >
        <div className="grid grid-cols-4">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                active(href) ? "text-white" : "text-white/45",
              )}
              aria-current={active(href) ? "page" : undefined}
            >
              <Icon className="size-5" strokeWidth={active(href) ? 2.2 : 1.6} />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
