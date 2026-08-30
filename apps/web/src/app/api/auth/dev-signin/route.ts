import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const SESSION_DAYS = 30;

/**
 * Development-only bypass for the magic-link flow: sandboxes and local dev have
 * no SMTP server, so there is otherwise no way to reach /studio. Refuses to run
 * unless NODE_ENV is non-production AND ALLOW_DEV_SIGNIN is explicitly set, so
 * a misconfigured deploy cannot hand out sessions.
 */
export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEV_SIGNIN !== "true") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, emailVerified: new Date() },
  });

  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.session.create({ data: { sessionToken, userId: user.id, expires } });

  const store = await cookies();
  store.set("authjs.session-token", sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires,
  });

  const callbackUrl = String(form.get("callbackUrl") ?? "/studio");
  // Relative Location keeps the browser on the same host it posted from —
  // an absolute URL built from request.url can flip 127.0.0.1 to localhost
  // and the cookie just set would not be sent on the redirected request.
  const path = callbackUrl.startsWith("/") ? callbackUrl : "/studio";
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}
