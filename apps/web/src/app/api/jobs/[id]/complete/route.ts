import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTourReadyEmail } from "@/lib/email";

// Called by the pipeline worker (pipeline/src/portal_pipeline/worker.py)
// when a job finishes — not the browser, so it authenticates with a shared
// secret rather than a user session.
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
    // The tour is already published at this point — a broken SMTP config or
    // transient send failure is a notification problem, not a reason to
    // fail this request and have the worker report (and record) the job as
    // failed when it actually succeeded.
    try {
      const tourUrl = `${process.env.NEXT_PUBLIC_APP_URL}/tours/${tour.id}`;
      await sendTourReadyEmail(job.tour.user.email, tour.name, tourUrl);
    } catch (error) {
      console.error("failed to send tour-ready email", error);
    }
  } else {
    await prisma.tour.update({ where: { id: job.tourId }, data: { status: "FAILED" } });
  }

  return NextResponse.json({ ok: true });
}
