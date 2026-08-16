import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueuePipelineJob } from "@/lib/queue";
import { ADDITIONAL_AREA_CREDIT_COST, TOUR_CREDIT_COST } from "@/lib/videoConstraints";

class InsufficientCreditsError extends Error {}

interface VideoInput {
  role: "OVERVIEW" | "AREA";
  areaName?: string;
  floor?: string;
  storageKey: string;
  durationSec?: number;
}

// Re-checked here even though the client already enforces this — client-side
// validation is UX, not a trust boundary, and this route is one.
function validateVideos(videos: VideoInput[]): string | null {
  const overviewCount = videos.filter((v) => v.role === "OVERVIEW").length;
  if (overviewCount !== 1) {
    return `expected exactly one OVERVIEW video, got ${overviewCount}`;
  }

  const areas = videos.filter((v) => v.role === "AREA");
  if (areas.length < 1) {
    return "at least one AREA video is required";
  }

  const names = areas.map((v) => (v.areaName ?? "").trim().toLowerCase());
  if (names.some((n) => n.length === 0)) {
    return "every AREA video needs a name";
  }
  if (new Set(names).size !== names.length) {
    return "area names must be unique";
  }
  if (videos.some((v) => !v.storageKey)) {
    return "every video needs a storageKey";
  }

  return null;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const { name, videos } = (await request.json()) as { name?: string; videos?: VideoInput[] };
  if (!name || !videos?.length) {
    return NextResponse.json({ error: "name and videos are required" }, { status: 400 });
  }

  const validationError = validateVideos(videos);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const areaCount = videos.filter((v) => v.role === "AREA").length;
  const creditCost = TOUR_CREDIT_COST + areaCount * ADDITIONAL_AREA_CREDIT_COST;

  try {
    const { tourId, jobId } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.credits < creditCost) {
        throw new InsufficientCreditsError();
      }

      const tour = await tx.tour.create({
        data: { userId, name, status: "UPLOADED" },
      });
      await tx.video.createMany({
        data: videos.map((v) => ({
          tourId: tour.id,
          role: v.role,
          areaName: v.role === "AREA" ? v.areaName?.trim() : null,
          floor: v.role === "AREA" ? v.floor?.trim() || null : null,
          storageKey: v.storageKey,
          durationSec: v.durationSec,
        })),
      });
      const job = await tx.job.create({
        data: { tourId: tour.id, stage: "queued", state: "queued" },
      });
      await tx.user.update({
        where: { id: userId },
        data: { credits: { decrement: creditCost } },
      });

      return { tourId: tour.id, jobId: job.id };
    });

    await enqueuePipelineJob({ jobId, tourId });

    return NextResponse.json({ tourId });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: "insufficient credits" }, { status: 402 });
    }
    throw error;
  }
}
