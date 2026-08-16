import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toTourStatusPayload } from "@/lib/tourStatus";

// Public — this is what the /tours/[id] page polls, and that page doubles
// as the share URL, so it can't require the owner's session.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const tour = await prisma.tour.findUnique({
    where: { id: params.id },
    include: { jobs: { orderBy: { startedAt: "desc" }, take: 1 } },
  });

  if (!tour) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json(toTourStatusPayload(tour));
}
