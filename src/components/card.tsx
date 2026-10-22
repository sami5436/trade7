import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("rounded-3xl border border-white/10 bg-[#0a0a0a] p-5 md:p-6", className)} {...props} />;
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-xs font-semibold tracking-[0.18em] text-white/50 uppercase">{children}</h2>
      {action}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium tracking-wider text-white/45 uppercase">{label}</div>
      <div className="tabular mt-1 truncate text-lg font-semibold md:text-xl">{value}</div>
      {sub != null && <div className="tabular truncate text-xs text-white/45">{sub}</div>}
    </div>
  );
}

export function Empty({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/12 px-6 py-10 text-center">
      <div className="text-base font-semibold">{title}</div>
      {body && <p className="mt-1 max-w-sm text-sm text-white/50">{body}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
