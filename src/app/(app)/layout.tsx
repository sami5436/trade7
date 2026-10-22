import { AppShell } from "@/components/app-shell";
import { StateProvider } from "@/components/state-provider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <StateProvider>
      <AppShell>{children}</AppShell>
    </StateProvider>
  );
}
