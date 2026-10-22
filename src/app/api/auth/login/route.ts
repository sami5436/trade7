import { NextResponse } from "next/server";
import { createSession, safeEqual, SESSION_COOKIE, SESSION_DAYS } from "@/lib/auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { passcode?: unknown };
  const expected = process.env.APP_PASSCODE;
  if (!expected) return NextResponse.json({ error: "Passcode is not configured." }, { status: 503 });
  if (typeof body.passcode !== "string" || !safeEqual(body.passcode.trim(), expected)) {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "Wrong passcode." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  return res;
}
