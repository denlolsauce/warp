import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { toTourStatusPayload } from "@/lib/tourStatus";
import { TourStatus } from "./TourStatus";

export default async function TourPage({ params }: { params: { id: string } }) {
  const tour = await prisma.tour.findUnique({
    where: { id: params.id },
    include: { jobs: { orderBy: { startedAt: "desc" }, take: 1 } },
  });
  if (!tour) notFound();

  return <TourStatus tourId={tour.id} initial={toTourStatusPayload(tour)} />;
}
