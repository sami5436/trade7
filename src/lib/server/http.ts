import "server-only";
import { NextResponse } from "next/server";
import { AlpacaError } from "./alpaca";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export function fail(e: unknown) {
  const status = e instanceof AlpacaError ? (e.status === 401 || e.status === 403 ? 503 : 502) : 500;
  const message =
    e instanceof AlpacaError
      ? e.status === 401 || e.status === 403
        ? "Market data is not connected."
        : `Broker error: ${e.message}`
      : "Something went wrong. Try again.";
  if (!(e instanceof AlpacaError)) console.error(e);
  return json({ error: message }, status);
}
