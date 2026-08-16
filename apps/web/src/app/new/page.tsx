import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UploadForm } from "./UploadForm";

export default async function NewTourPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin?callbackUrl=/new");
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });

  return (
    <main>
      <h1>New tour</h1>
      <UploadForm userCredits={user.credits} />
    </main>
  );
}
