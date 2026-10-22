import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let client: NeonQueryFunction<false, false> | null = null;

export function sql() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = neon(url);
  }
  return client;
}

/** Postgres numerics arrive as strings. */
export function num(v: unknown): number {
  return v == null ? 0 : Number(v);
}

export function numOrNull(v: unknown): number | null {
  return v == null ? null : Number(v);
}
