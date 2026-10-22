import { safeEqual } from "@/lib/auth";
import { tick } from "@/lib/server/bot";
import { fail, json } from "@/lib/server/http";

export const maxDuration = 120;

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(header, `Bearer ${secret}`)) return json({ error: "Unauthorized" }, 401);
  try {
    return json(await tick("schedule", 30));
  } catch (e) {
    return fail(e);
  }
}

export const GET = handle;
export const POST = handle;
