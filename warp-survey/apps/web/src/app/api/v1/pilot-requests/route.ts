import { pilotRequestBody } from "@warp-survey/contracts";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/queue";

const RATE_LIMIT_WINDOW_SECONDS = 3600;
const RATE_LIMIT_MAX = 5;

/**
 * Public pilot enquiry. Creates a lead only — never a login account, and no
 * automated sales messages are sent.
 */
export async function POST(request: Request) {
  const parsed = pilotRequestBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Please complete the required fields.", issues: parsed.error.issues }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateKey = `warp-survey:ratelimit:pilot:${ip}`;
  const count = await redis.incr(rateKey);
  if (count === 1) await redis.expire(rateKey, RATE_LIMIT_WINDOW_SECONDS);
  if (count > RATE_LIMIT_MAX) {
    return Response.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const { notes, ...rest } = parsed.data;
  await prisma.pilotRequest.create({ data: { ...rest, notes: notes ?? null } });
  return Response.json({ ok: true }, { status: 201 });
}
