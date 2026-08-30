import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

// Public endpoint — anyone on the marketing site can POST here, so every
// field is length-capped before it reaches the database and only the four
// fields the form actually collects are read off the body.
const MAX_EMAIL = 254; // RFC 5321 practical limit
const MAX_COMPANY = 200;
const MAX_VOLUME = 40;
const MAX_NOTES = 2000;

// Deliberately permissive: the point is to catch obvious junk, not to
// adjudicate what a valid address looks like. Delivery is the real test.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }
  const payload = (body ?? {}) as Record<string, unknown>;

  const email = clean(payload.email, MAX_EMAIL)?.toLowerCase() ?? null;
  if (!email || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "a valid email address is required" }, { status: 400 });
  }

  const data = {
    company: clean(payload.company, MAX_COMPANY),
    volume: clean(payload.volume, MAX_VOLUME),
    notes: clean(payload.notes, MAX_NOTES),
  };

  try {
    // Upsert rather than create: someone resubmitting shouldn't hit a unique
    // constraint error, and their newer answers are the ones worth keeping.
    await prisma.waitlistSignup.upsert({
      where: { email },
      create: { email, ...data },
      update: data,
    });
  } catch (error) {
    console.error("[waitlist] failed to record signup", error);
    return NextResponse.json({ error: "could not record signup" }, { status: 500 });
  }

  // No echo of what was stored — the response goes back to an unauthenticated
  // caller, and confirming which addresses are on the list would make this a
  // membership oracle.
  return NextResponse.json({ ok: true }, { status: 201 });
}
