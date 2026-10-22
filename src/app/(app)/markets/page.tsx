import { Suspense } from "react";
import type { Metadata } from "next";
import { Markets } from "@/components/markets";

export const metadata: Metadata = { title: "Markets" };

export default function MarketsPage() {
  return (
    <Suspense>
      <Markets />
    </Suspense>
  );
}
