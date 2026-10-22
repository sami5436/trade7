import { cn } from "@/lib/utils";

export type Label = "BUY" | "SELL" | "WAIT" | "EXIT";

export function SignalBadge({ action, size = "sm", className }: { action: Label; size?: "sm" | "lg"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-bold tracking-wider",
        size === "lg" ? "h-9 min-w-20 px-4 text-sm" : "h-7 min-w-14 px-3 text-[11px]",
        action === "BUY" && "bg-white text-black",
        action === "SELL" && "border-2 border-white text-white",
        action === "WAIT" && "border border-white/15 text-white/50",
        action === "EXIT" && "bg-white/15 text-white",
        className,
      )}
    >
      {action}
    </span>
  );
}
