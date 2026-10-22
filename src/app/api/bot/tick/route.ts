import { tick } from "@/lib/server/bot";
import { fail, json } from "@/lib/server/http";

export const maxDuration = 120;

// Called by the open app about once a minute. Runs only if the last pass is older than 50 seconds.
export async function POST() {
  try {
    return json(await tick("app", 50));
  } catch (e) {
    return fail(e);
  }
}
