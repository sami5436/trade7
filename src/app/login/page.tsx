import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: { absolute: "TRADE7 | Momentum Trading Terminal" } };

export default function LoginPage() {
  return (
    <main className="pt-safe pb-safe flex min-h-dvh items-center justify-center px-6">
      <LoginForm />
    </main>
  );
}
