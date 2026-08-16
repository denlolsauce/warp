import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTourReadyEmail } from "@/lib/email";

// Called by the pipeline worker when a job finishes — not the browser, so it
// authenticates with a shared secret rather than a user session. Nothing
// calls this yet: the Redis-consuming worker daemon itself isn't built
// (out of scope for apps/web), so this is the endpoint it will call once it
// exists, wired against the schema's existing Job/Tour status columns.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const secret = request.headers.get("x-worker-secret");
  if (!secret || secret !== process.env.WORKER_CALLBACK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { status, manifestUrl, errorMessage } = (await request.json()) as {
    status?: "success" | "failure";
    manifestUrl?: string;
    errorMessage?: string;
  };
  if (status !== "success" && status !== "failure") {
    return NextResponse.json({ error: "status must be 'success' or 'failure'" }, { status: 400 });
  }

  const job = await prisma.job.update({
    where: { id: params.id },
    data: {
      state: status === "success" ? "completed" : "failed",
      finishedAt: new Date(),
      errorMessage: errorMessage ?? null,
    },
    include: { tour: { include: { user: true } } },
  });

  if (status === "success") {
    const tour = await prisma.tour.update({
      where: { id: job.tourId },
      data: { status: "PUBLISHED", manifestUrl: manifestUrl ?? null },
    });
    const tourUrl = `${process.env.NEXT_PUBLIC_APP_URL}/tours/${tour.id}`;
    await sendTourReadyEmail(job.tour.user.email, tour.name, tourUrl);
  } else {
    await prisma.tour.update({ where: { id: job.tourId }, data: { status: "FAILED" } });
  }

  return NextResponse.json({ ok: true });
}
